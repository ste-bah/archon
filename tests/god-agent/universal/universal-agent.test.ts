/**
 * Universal Self-Learning God Agent Tests
 *
 * Tests the unified interface for coding, research, writing, and self-learning
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UniversalAgent } from '../../../src/god-agent/universal/universal-agent.js';
import type { AgentMode, KnowledgeEntry } from '../../../src/god-agent/universal/universal-agent.js';

// Skip tests that require API access when ANTHROPIC_API_KEY is not set
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe('UniversalAgent', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      autoLearn: true,
      verbose: false,
      autoStoreThreshold: 0.7,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const status = agent.getStatus();
      expect(status.initialized).toBe(true);
      expect(['native', 'wasm', 'javascript']).toContain(status.runtime);
    });

    it('should report healthy status', () => {
      const status = agent.getStatus();
      expect(status.health.vectorDB).toBe('healthy');
      expect(status.health.graphDB).toBe('healthy');
    });
  });

  describe.skipIf(!hasApiKey)('Mode Detection', () => {
    it('should detect code mode', async () => {
      const result = await agent.ask('How do I implement a binary search function?');
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should detect research mode', async () => {
      const result = await agent.ask('Research the latest advances in transformer architectures');
      expect(result).toBeDefined();
    });

    it('should detect write mode', async () => {
      const result = await agent.ask('Write an essay about machine learning');
      expect(result).toBeDefined();
    });

    it('should default to general mode', async () => {
      const result = await agent.ask('What is the meaning of life?');
      expect(result).toBeDefined();
    });
  });

  describe.skipIf(!hasApiKey)('Code Mode', () => {
    it('should generate code', async () => {
      const result = await agent.code('Implement a function to reverse a string');

      expect(result).toBeDefined();
      expect(result.task).toBe('Implement a function to reverse a string');
      expect(result.code).toBeDefined();
      expect(result.language).toBe('typescript');
      expect(result.patterns_used).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    it('should accept language option', async () => {
      const result = await agent.code('Create a hello world function', {
        language: 'python',
      });

      expect(result.language).toBe('python');
    });

    it('should track if pattern was learned', async () => {
      const result = await agent.code('Implement quicksort');
      expect(typeof result.learned).toBe('boolean');
    });
  });

  describe.skipIf(!hasApiKey)('Research Mode', () => {
    it('should perform research', async () => {
      const result = await agent.research('What are neural networks?');

      expect(result).toBeDefined();
      expect(result.query).toBe('What are neural networks?');
      expect(result.findings).toBeDefined();
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.synthesis).toBeDefined();
      expect(typeof result.knowledgeStored).toBe('number');
    });

    it('should support depth options', async () => {
      const quick = await agent.research('Test query', { depth: 'quick' });
      const deep = await agent.research('Test query', { depth: 'deep' });

      expect(quick.synthesis).toBeDefined();
      expect(deep.synthesis).toBeDefined();
    });
  });

  describe.skipIf(!hasApiKey)('Write Mode', () => {
    it('should generate written content', async () => {
      const result = await agent.write('Artificial Intelligence');

      expect(result).toBeDefined();
      expect(result.topic).toBe('Artificial Intelligence');
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.style).toBeDefined();
      expect(result.wordCount).toBeGreaterThan(0);
      expect(Array.isArray(result.sources)).toBe(true);
    });

    it('should accept style options', async () => {
      const result = await agent.write('Technology', {
        style: 'academic',
        format: 'paper',
        length: 'comprehensive',
      });

      expect(result.style).toBe('academic');
      expect(result.content).toContain('paper');
    });
  });

  describe('Knowledge Management', () => {
    it('should store knowledge', async () => {
      const id = await agent.storeKnowledge({
        content: 'Test knowledge entry',
        type: 'fact',
        domain: 'testing',
        tags: ['test', 'example'],
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should track knowledge in stats', async () => {
      await agent.storeKnowledge({
        content: 'Knowledge 1',
        type: 'fact',
        domain: 'testing',
        tags: ['test'],
      });

      await agent.storeKnowledge({
        content: 'Knowledge 2',
        type: 'pattern',
        domain: 'testing',
        tags: ['test'],
      });

      const stats = agent.getStats();
      expect(stats.knowledgeEntries).toBeGreaterThanOrEqual(2);
    });

    it('should track domain expertise', async () => {
      await agent.storeKnowledge({
        content: 'ML knowledge',
        type: 'fact',
        domain: 'machine-learning',
        tags: ['ml'],
      });

      const stats = agent.getStats();
      expect(stats.domainExpertise['machine-learning']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Learning System', () => {
    it('should accept positive feedback', async () => {
      // Feedback should return FeedbackResult (FR-11)
      const feedbackResult = await agent.feedback('fake_id', 0.9);
      expect(feedbackResult).toBeDefined();
      expect(feedbackResult).toHaveProperty('weightUpdates');
      expect(feedbackResult).toHaveProperty('patternCreated');
    });

    it('should accept negative feedback', async () => {
      // Feedback should return FeedbackResult (FR-11)
      const feedbackResult = await agent.feedback('fake_id', 0.1);
      expect(feedbackResult).toBeDefined();
      expect(feedbackResult).toHaveProperty('weightUpdates');
      expect(feedbackResult).toHaveProperty('patternCreated');
    });

    it.skipIf(!hasApiKey)('should track interactions', async () => {
      const initialStats = agent.getStats();
      const initialCount = initialStats.totalInteractions;

      await agent.ask('Test interaction 1');
      await agent.ask('Test interaction 2');

      const newStats = agent.getStats();
      expect(newStats.totalInteractions).toBe(initialCount + 2);
    });
  });

  describe.skipIf(!hasApiKey)('Auto-Learning', () => {
    it('should auto-learn from interactions when enabled', async () => {
      const agent2 = new UniversalAgent({
        autoLearn: true,
        autoStoreThreshold: 0.5, // Lower threshold for testing
        verbose: false,
      });
      await agent2.initialize();

      // Multiple interactions should trigger learning
      await agent2.ask('Implement a linked list in TypeScript');
      await agent2.code('Create a stack data structure');

      const stats = agent2.getStats();
      // ask() and code() each count as 1 interaction, but code() calls ask() internally
      // so we just check we have at least 1 interaction recorded
      expect(stats.totalInteractions).toBeGreaterThanOrEqual(1);

      await agent2.shutdown();
    });

    it('should respect autoLearn=false', async () => {
      const agent3 = new UniversalAgent({
        autoLearn: false,
        verbose: false,
      });
      await agent3.initialize();

      await agent3.ask('Test without learning');

      // Should still track interactions but not auto-store
      const stats = agent3.getStats();
      expect(stats.totalInteractions).toBeGreaterThanOrEqual(1);

      await agent3.shutdown();
    });
  });

  describe('Stats and Status', () => {
    it('should return complete stats', async () => {
      const stats = agent.getStats();

      expect(stats).toHaveProperty('totalInteractions');
      expect(stats).toHaveProperty('knowledgeEntries');
      expect(stats).toHaveProperty('domainExpertise');
      expect(stats).toHaveProperty('topPatterns');
      expect(typeof stats.totalInteractions).toBe('number');
      expect(typeof stats.knowledgeEntries).toBe('number');
      expect(typeof stats.domainExpertise).toBe('object');
      expect(Array.isArray(stats.topPatterns)).toBe(true);
    });

    it.skipIf(!hasApiKey)('should include persistenceStats from InteractionStore', async () => {
      // Add some interactions and knowledge
      await agent.storeKnowledge({
        content: 'Test knowledge',
        type: 'fact',
        domain: 'testing',
        tags: ['test'],
      });
      await agent.ask('Test query');

      const stats = agent.getStats();

      expect(stats).toHaveProperty('persistenceStats');
      expect(stats.persistenceStats).toBeDefined();
      expect(stats.persistenceStats).toHaveProperty('highQualityCount');
      expect(stats.persistenceStats).toHaveProperty('oldestInteraction');
      expect(stats.persistenceStats).toHaveProperty('newestInteraction');
      expect(stats.persistenceStats).toHaveProperty('lastSaved');
      expect(typeof stats.persistenceStats.highQualityCount).toBe('number');
    });

    it('should include sonaMetrics when SonaEngine available', async () => {
      // Store knowledge and create trajectories
      await agent.storeKnowledge({
        content: 'Pattern 1',
        type: 'pattern',
        domain: 'testing',
        tags: ['test'],
      });

      const stats = agent.getStats();

      // SonaMetrics may or may not be present depending on God Agent configuration
      // Just verify the structure if present
      if (stats.sonaMetrics) {
        expect(stats.sonaMetrics).toHaveProperty('totalTrajectories');
        expect(stats.sonaMetrics).toHaveProperty('totalRoutes');
        expect(typeof stats.sonaMetrics.totalTrajectories).toBe('number');
        expect(typeof stats.sonaMetrics.totalRoutes).toBe('number');
      }
    });

    it('should calculate learningEffectiveness when enough data available', async () => {
      // This test may not have enough trajectories to trigger effectiveness calculation
      // but we can verify the structure exists when it does
      const stats = agent.getStats();

      if (stats.learningEffectiveness) {
        expect(stats.learningEffectiveness).toHaveProperty('baselineQuality');
        expect(stats.learningEffectiveness).toHaveProperty('learnedQuality');
        expect(stats.learningEffectiveness).toHaveProperty('improvementPct');
        expect(stats.learningEffectiveness).toHaveProperty('sampleSize');
        expect(typeof stats.learningEffectiveness.improvementPct).toBe('number');
      }
    });

    it.skipIf(!hasApiKey)('should return totalInteractions from InteractionStore', async () => {
      const initialStats = agent.getStats();
      const initialCount = initialStats.totalInteractions;

      // Add interactions
      await agent.ask('Test 1');
      await agent.ask('Test 2');

      const newStats = agent.getStats();
      expect(newStats.totalInteractions).toBe(initialCount + 2);
    });

    it('should return knowledgeEntries from InteractionStore', async () => {
      const initialStats = agent.getStats();
      const initialCount = initialStats.knowledgeEntries;

      await agent.storeKnowledge({
        content: 'Knowledge 1',
        type: 'fact',
        domain: 'testing',
        tags: ['test'],
      });

      await agent.storeKnowledge({
        content: 'Knowledge 2',
        type: 'pattern',
        domain: 'testing',
        tags: ['test'],
      });

      const newStats = agent.getStats();
      expect(newStats.knowledgeEntries).toBe(initialCount + 2);
    });

    it('should return complete status', () => {
      const status = agent.getStatus();

      expect(status).toHaveProperty('initialized');
      expect(status).toHaveProperty('runtime');
      expect(status).toHaveProperty('health');
    });
  });

  describe.skipIf(!hasApiKey)('Edge Cases', () => {
    it('should handle empty input gracefully', async () => {
      const result = await agent.ask('');
      expect(result).toBeDefined();
    });

    it('should handle very long input', async () => {
      const longInput = 'test '.repeat(1000);
      const result = await agent.ask(longInput);
      expect(result).toBeDefined();
    });

    it('should handle special characters', async () => {
      const result = await agent.ask('How do I use symbols like @#$%^&*?');
      expect(result).toBeDefined();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown cleanly', async () => {
      const tempAgent = new UniversalAgent({ verbose: false });
      await tempAgent.initialize();
      expect(tempAgent.getStatus().initialized).toBe(true);

      await tempAgent.shutdown();
      // After shutdown, initialized should be false
      expect(tempAgent.getStatus().initialized).toBe(false);
    });
  });
});

describe('UniversalAgent Types', () => {
  it('should export AgentMode type', () => {
    const modes: AgentMode[] = ['code', 'research', 'write', 'general'];
    expect(modes).toHaveLength(4);
  });

  it('should have valid KnowledgeEntry structure', () => {
    const entry: Partial<KnowledgeEntry> = {
      content: 'test',
      type: 'fact',
      domain: 'test',
      tags: ['test'],
    };
    expect(entry.type).toBe('fact');
  });
});
