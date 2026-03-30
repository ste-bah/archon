/**
 * Persistence Tests for Universal Self-Learning God Agent
 *
 * Tests that data persists across agent restarts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UniversalAgent } from '../../../src/god-agent/universal/universal-agent.js';
import { rm, readFile, access } from 'fs/promises';
import { join } from 'path';

const TEST_STORAGE_DIR = '.agentdb/test-persistence';

describe('UniversalAgent Persistence', () => {
  beforeEach(async () => {
    // Clean up test storage before each test
    await rm(TEST_STORAGE_DIR, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(async () => {
    // Clean up test storage after each test
    await rm(TEST_STORAGE_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('Storage Directory Creation', () => {
    it('should create storage directories on init', async () => {
      const agent = new UniversalAgent({
        enablePersistence: true,
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent.initialize();

      // Check directories were created
      await expect(access(TEST_STORAGE_DIR)).resolves.toBeUndefined();
      await expect(access(join(TEST_STORAGE_DIR, 'graphs'))).resolves.toBeUndefined();
      await expect(access(join(TEST_STORAGE_DIR, 'weights'))).resolves.toBeUndefined();
      await expect(access(join(TEST_STORAGE_DIR, 'checkpoints'))).resolves.toBeUndefined();

      await agent.shutdown();
    });
  });

  describe('State Persistence', () => {
    it('should save state on shutdown', async () => {
      const agent = new UniversalAgent({
        enablePersistence: true,
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent.initialize();

      // Store some knowledge to create domain expertise
      await agent.storeKnowledge({
        content: 'Test knowledge for persistence',
        type: 'fact',
        domain: 'testing',
        tags: ['test', 'persistence'],
      });

      await agent.shutdown();

      // Check state file was created
      const statePath = join(TEST_STORAGE_DIR, 'agent-state.json');
      const stateData = await readFile(statePath, 'utf-8');
      const state = JSON.parse(stateData);

      expect(state).toHaveProperty('domainExpertise');
      expect(state).toHaveProperty('successfulPatterns');
      expect(state).toHaveProperty('lastSaved');
      expect(state.domainExpertise.testing).toBeGreaterThanOrEqual(1);
    });

    it('should restore state on init', async () => {
      // First agent: store knowledge and shutdown
      const agent1 = new UniversalAgent({
        enablePersistence: true,
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent1.initialize();

      await agent1.storeKnowledge({
        content: 'Knowledge entry 1',
        type: 'fact',
        domain: 'domain-a',
        tags: ['test'],
      });

      await agent1.storeKnowledge({
        content: 'Knowledge entry 2',
        type: 'pattern',
        domain: 'domain-b',
        tags: ['test'],
      });

      const stats1 = agent1.getStats();
      expect(stats1.domainExpertise['domain-a']).toBe(1);
      expect(stats1.domainExpertise['domain-b']).toBe(1);

      await agent1.shutdown();

      // Second agent: should restore state
      const agent2 = new UniversalAgent({
        enablePersistence: true,
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent2.initialize();

      const stats2 = agent2.getStats();
      expect(stats2.domainExpertise['domain-a']).toBe(1);
      expect(stats2.domainExpertise['domain-b']).toBe(1);

      await agent2.shutdown();
    });
  });

  describe('Manual Save', () => {
    it('should allow manual state save', async () => {
      const agent = new UniversalAgent({
        enablePersistence: true,
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent.initialize();

      await agent.storeKnowledge({
        content: 'Test content',
        type: 'fact',
        domain: 'manual-save-test',
        tags: ['test'],
      });

      // Manual save without shutdown
      await agent.saveState();

      // Verify state was saved
      const statePath = join(TEST_STORAGE_DIR, 'agent-state.json');
      const stateData = await readFile(statePath, 'utf-8');
      const state = JSON.parse(stateData);

      expect(state.domainExpertise['manual-save-test']).toBe(1);

      await agent.shutdown();
    });
  });

  describe('Persistence Disabled', () => {
    it('should not create storage when persistence disabled', async () => {
      const agent = new UniversalAgent({
        enablePersistence: false,
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent.initialize();
      await agent.shutdown();

      // Storage dir should not exist
      await expect(access(TEST_STORAGE_DIR)).rejects.toThrow();
    });
  });

  describe('Default Persistence', () => {
    it('should enable persistence by default', async () => {
      const agent = new UniversalAgent({
        storageDir: TEST_STORAGE_DIR,
        verbose: false,
      });

      await agent.initialize();
      await agent.shutdown();

      // Storage dir should exist (persistence is enabled by default)
      await expect(access(TEST_STORAGE_DIR)).resolves.toBeUndefined();
    });
  });
});
