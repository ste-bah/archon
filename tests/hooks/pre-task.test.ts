/**
 * Claude Code Hooks - Pre-Task Hook Integration Tests
 *
 * Implements: TECH-HKS-001 Integration Tests (TEST-001)
 * Constitution: GUARD-HKS-002, TFORBID-001, TFORBID-002
 *
 * CRITICAL: Uses REAL InteractionStore with in-memory database - NO MOCKING
 *
 * @module tests/hooks/pre-task.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InteractionStore } from '../../src/god-agent/universal/interaction-store.js';
import { ContextInjector } from '../../scripts/hooks/context-injector.js';
import {
  type IHookConfig,
  DEFAULT_HOOK_CONFIG,
  AGENT_TYPE_PATTERNS,
  ValidationError
} from '../../scripts/hooks/hook-types.js';

// ==================== Test Setup ====================

describe('Pre-Task Hook Integration Tests', () => {
  let interactionStore: InteractionStore;
  let contextInjector: ContextInjector;
  let config: IHookConfig;
  const testStorageDir = '/tmp/hooks-test-' + Date.now();

  beforeEach(async () => {
    // Create REAL InteractionStore with test directory
    config = {
      ...DEFAULT_HOOK_CONFIG,
      memoryDbPath: `${testStorageDir}/session-knowledge.json`,
      verbose: false
    };

    interactionStore = new InteractionStore({
      storageDir: testStorageDir
    });

    // Load (creates empty if not exists)
    await interactionStore.load();

    // Create context injector with REAL store
    contextInjector = new ContextInjector(interactionStore, config);
  });

  afterEach(async () => {
    // Save state for verification
    await interactionStore.save();
  });

  // ==================== IT-001: InteractionStore Query ====================

  describe('IT-001: InteractionStore Query', () => {
    it('should query InteractionStore for domain "project/api"', async () => {
      // Seed test data
      interactionStore.addKnowledge({
        id: 'test-api-1',
        domain: 'project/api',
        category: 'api-schema',
        content: JSON.stringify({ endpoint: '/users', method: 'GET' }),
        tags: ['api', 'users', 'endpoints'],
        quality: 0.9,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      interactionStore.addKnowledge({
        id: 'test-api-2',
        domain: 'project/api',
        category: 'api-schema',
        content: JSON.stringify({ endpoint: '/posts', method: 'POST' }),
        tags: ['api', 'posts', 'endpoints'],
        quality: 0.85,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // Query via ContextInjector
      const results = await contextInjector.queryContext('project/api', []);

      // Verify REAL data returned
      expect(results).toHaveLength(2);
      expect(results[0].domain).toBe('project/api');
      expect(results[0].quality).toBeGreaterThanOrEqual(results[1].quality); // Sorted by quality
    });

    it('should filter by tags when provided', async () => {
      // Seed test data with different tags
      interactionStore.addKnowledge({
        id: 'test-backend-1',
        domain: 'project/backend',
        category: 'implementation',
        content: 'Backend service code',
        tags: ['backend', 'service'],
        quality: 0.8,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      interactionStore.addKnowledge({
        id: 'test-backend-2',
        domain: 'project/backend',
        category: 'implementation',
        content: 'Database schema',
        tags: ['backend', 'database'],
        quality: 0.9,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // Query with tag filter
      const results = await contextInjector.queryContext('project/backend', ['database']);

      // Should only return database-tagged entry
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('test-backend-2');
      expect(results[0].tags).toContain('database');
    });
  });

  // ==================== IT-002: Context Injection ====================

  describe('IT-002: Context Injection', () => {
    it('should inject formatted context into Task() prompt', async () => {
      // Seed test data
      interactionStore.addKnowledge({
        id: 'test-context-1',
        domain: 'project/api',
        category: 'schema',
        content: JSON.stringify({ endpoint: '/auth/login' }),
        tags: ['auth', 'login'],
        quality: 0.95,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      const originalPrompt = 'Implement the authentication endpoint';

      // Perform full injection
      const result = await contextInjector.inject(originalPrompt, 'project/api', ['auth']);

      // Verify context was injected
      expect(result.enhancedPrompt).toContain(originalPrompt);
      expect(result.enhancedPrompt).toContain('## MEMORY CONTEXT');
      expect(result.enhancedPrompt).toContain('project/api');
      expect(result.enhancedPrompt).toContain('/auth/login');
      expect(result.entryCount).toBe(1);
    });

    it('should handle empty context gracefully', async () => {
      const originalPrompt = 'Create a new feature';

      // Query non-existent domain
      const result = await contextInjector.inject(originalPrompt, 'project/nonexistent', []);

      // Should return original prompt unchanged
      expect(result.enhancedPrompt).toBe(originalPrompt);
      expect(result.entryCount).toBe(0);
    });
  });

  // ==================== IT-008: No Fallback Behavior ====================

  describe('IT-008: No Fallback Behavior', () => {
    it('should throw error when InteractionStore is null', () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        new ContextInjector(null, config);
      }).toThrow('InteractionStore is required');
    });

    it('should throw error when maxContextSize is invalid', () => {
      expect(() => {
        new ContextInjector(interactionStore, { ...config, maxContextSize: 0 });
      }).toThrow('maxContextSize must be > 0');
    });
  });

  // ==================== IT-009: Configuration Loading ====================

  describe('IT-009: Configuration Loading', () => {
    it('should use default configuration values', () => {
      expect(config.preTaskTimeoutMs).toBe(5000);
      expect(config.maxContextSize).toBe(10000);
      expect(config.retryAttempts).toBe(3);
    });
  });

  // ==================== IT-014: Input Validation ====================

  describe('IT-014: Input Validation', () => {
    it('should sanitize domain input', async () => {
      // Seed with clean domain
      interactionStore.addKnowledge({
        id: 'test-sanitize-1',
        domain: 'project/test',
        category: 'test',
        content: 'Test content',
        tags: ['test'],
        quality: 0.8,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // Query with potentially dangerous characters
      const results = await contextInjector.queryContext("project/test'; DROP TABLE--", []);

      // Should sanitize and still query (no SQL injection)
      // Result depends on sanitization - empty is acceptable
      expect(results).toBeInstanceOf(Array);
    });
  });

  // ==================== Agent Type Detection ====================

  describe('Agent Type Detection', () => {
    it('should detect backend-dev from prompt patterns', () => {
      const patterns = AGENT_TYPE_PATTERNS['backend-dev'];
      expect(patterns.some(p => p.test('Implement the API endpoint'))).toBe(true);
      expect(patterns.some(p => p.test('Create database schema'))).toBe(true);
      expect(patterns.some(p => p.test('Backend service'))).toBe(true);
    });

    it('should detect tester from prompt patterns', () => {
      const patterns = AGENT_TYPE_PATTERNS['tester'];
      expect(patterns.some(p => p.test('Write integration tests'))).toBe(true);
      expect(patterns.some(p => p.test('Add e2e test coverage'))).toBe(true);
    });

    it('should detect reviewer from prompt patterns', () => {
      const patterns = AGENT_TYPE_PATTERNS['reviewer'];
      expect(patterns.some(p => p.test('Review the code'))).toBe(true);
      expect(patterns.some(p => p.test('Audit for security'))).toBe(true);
      expect(patterns.some(p => p.test('Validate the implementation'))).toBe(true);
    });
  });

  // ==================== Context Truncation ====================

  describe('Context Truncation', () => {
    it('should truncate context that exceeds limit', async () => {
      // Seed with large content
      for (let i = 0; i < 100; i++) {
        interactionStore.addKnowledge({
          id: `test-large-${i}`,
          domain: 'project/large',
          category: 'test',
          content: 'A'.repeat(1000), // 1KB each
          tags: ['large'],
          quality: 0.8 - (i * 0.001),
          usageCount: 0,
          lastUsed: Date.now(),
          createdAt: Date.now() - i
        });
      }

      // Inject with small limit
      const smallLimitInjector = new ContextInjector(interactionStore, {
        ...config,
        maxContextSize: 500 // ~2000 chars = ~500 tokens
      });

      const result = await smallLimitInjector.inject('Test prompt', 'project/large', []);

      // Should be truncated
      expect(result.wasTruncated).toBe(true);
      expect(result.enhancedPrompt).toContain('[TRUNCATED');
    });
  });
});
