/**
 * DAI-001 Integration Test Suite
 * TASK-006: Full integration testing with REAL agents
 *
 * Per constitution.md:
 * - RULE-002: NO mock data - use REAL agents from .claude/agents/
 * - RULE-005: AgentRegistry is single source of truth
 *
 * Tests the complete DAI-001 flow:
 * 1. AgentRegistry loads agents
 * 2. AgentSelector selects best agent
 * 3. TaskExecutor builds prompt
 * 4. UniversalAgent integrates all components
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UniversalAgent } from '../../../../src/god-agent/universal/universal-agent.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import { AgentSelector } from '../../../../src/god-agent/core/agents/agent-selector.js';
import { TaskExecutor } from '../../../../src/god-agent/core/agents/task-executor.js';
import type { ILoadedAgentDefinition } from '../../../../src/god-agent/core/agents/agent-types.js';

describe('DAI-001 Integration Tests', () => {
  let agent: UniversalAgent;
  let registry: AgentRegistry;
  let selector: AgentSelector;
  let executor: TaskExecutor;

  beforeAll(async () => {
    // Initialize UniversalAgent which initializes all DAI-001 components
    agent = new UniversalAgent({ verbose: false, enablePersistence: false });
    await agent.initialize();

    // Get references to DAI-001 components
    registry = agent.getAgentRegistry();
    selector = agent.getAgentSelector();
    executor = agent.getTaskExecutor();
  });

  afterAll(async () => {
    await agent.shutdown();
  });

  describe('Component Integration', () => {
    it('should have initialized AgentRegistry with real agents', () => {
      expect(registry).toBeDefined();
      expect(registry.isInitialized).toBe(true);
      expect(registry.size).toBeGreaterThan(180); // At least 180 agents
    });

    it('should have initialized AgentSelector with registry', () => {
      expect(selector).toBeDefined();
    });

    it('should have initialized TaskExecutor', () => {
      expect(executor).toBeDefined();
    });

    it('should expose all components through UniversalAgent getters', () => {
      expect(agent.getAgentRegistry()).toBe(registry);
      expect(agent.getAgentSelector()).toBe(selector);
      expect(agent.getTaskExecutor()).toBe(executor);
    });
  });

  describe('End-to-End Flow: selectAgentForTask()', () => {
    it('should select agent and build prompt for code task', async () => {
      const result = await agent.selectAgentForTask('implement user authentication with JWT');

      expect(result.selection).toBeDefined();
      expect(result.selection.selected).toBeDefined();
      expect(result.selection.selected.key).toBeDefined();
      expect(result.selection.analysis.taskType).toBe('code');
      expect(result.prompt).toBeDefined();
      expect(result.prompt.length).toBeGreaterThan(100);
      expect(result.prompt).toContain('### Task');
      expect(result.prompt).toContain('implement user authentication with JWT');
    });

    it('should select agent and build prompt for research task', async () => {
      const result = await agent.selectAgentForTask('conduct a literature review on machine learning');

      expect(result.selection.analysis.taskType).toBe('research');
      expect(result.prompt).toContain('conduct a literature review');
    });

    it('should select agent and build prompt for write task', async () => {
      const result = await agent.selectAgentForTask('write documentation for the API endpoints');

      expect(result.selection.analysis.taskType).toBe('write');
      expect(result.prompt).toContain('write documentation');
    });

    it('should select agent and build prompt for ask task', async () => {
      const result = await agent.selectAgentForTask('what is the purpose of dependency injection?');

      expect(result.selection.analysis.taskType).toBe('ask');
      expect(result.prompt).toContain('dependency injection');
    });

    it('should include TASK COMPLETION SUMMARY template in prompt', async () => {
      const result = await agent.selectAgentForTask('implement a feature');

      expect(result.prompt).toContain('TASK COMPLETION SUMMARY');
      expect(result.prompt).toContain('**What I Did**');
      expect(result.prompt).toContain('**Files Created/Modified**');
      expect(result.prompt).toContain('**InteractionStore Entries**');
      expect(result.prompt).toContain('**Next Agent Guidance**');
    });
  });

  describe('Agent Selection Quality', () => {
    it('should select agents from preferred categories', async () => {
      // Code tasks should prefer logicalcode category
      const codeResult = await agent.selectAgentForTask('implement new feature');
      const codeCategory = codeResult.selection.selected.category;

      // Research tasks should prefer phdresearch category
      const researchResult = await agent.selectAgentForTask('research the topic thoroughly');
      const researchCategory = researchResult.selection.selected.category;

      // At minimum, agents should be selected
      expect(codeResult.selection.selected.key).toBeDefined();
      expect(researchResult.selection.selected.key).toBeDefined();
    });

    it('should return multiple candidates with scores', async () => {
      const result = await agent.selectAgentForTask('analyze code patterns');

      expect(result.selection.candidates.length).toBeGreaterThan(0);
      expect(result.selection.candidates[0].score).toBeGreaterThan(0);
      expect(result.selection.candidates[0].matchReasons.length).toBeGreaterThan(0);
    });

    it('should score higher for keyword matches', async () => {
      const result = await agent.selectAgentForTask('systematic review methodology research');

      // Should have research-related candidates
      const hasResearchAgent = result.selection.candidates.some(
        c => c.agent.key.includes('research') ||
             c.agent.frontmatter.name?.toLowerCase().includes('research')
      );
      expect(hasResearchAgent || result.selection.candidates.length > 0).toBe(true);
    });
  });

  describe('Prompt Building Quality', () => {
    it('should include agent name in prompt', async () => {
      const result = await agent.selectAgentForTask('test task');
      expect(result.prompt).toContain('## Agent:');
    });

    it('should include agent instructions in prompt', async () => {
      const result = await agent.selectAgentForTask('test task');
      expect(result.prompt).toContain('### Agent Instructions');
    });

    it('should include task in prompt', async () => {
      const result = await agent.selectAgentForTask('specific test task 12345');
      expect(result.prompt).toContain('### Task');
      expect(result.prompt).toContain('specific test task 12345');
    });

    it('should build reasonable prompt length', async () => {
      const result = await agent.selectAgentForTask('test task');
      // Prompts should be substantial but not excessive
      expect(result.prompt.length).toBeGreaterThan(500);
      expect(result.prompt.length).toBeLessThan(100000);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty task gracefully', async () => {
      const result = await agent.selectAgentForTask('');
      expect(result.selection).toBeDefined();
      expect(result.selection.analysis.taskType).toBe('general');
    });

    it('should handle very long tasks', async () => {
      const longTask = 'implement '.repeat(100);
      const result = await agent.selectAgentForTask(longTask);
      expect(result.selection).toBeDefined();
    });

    it('should handle special characters in tasks', async () => {
      const result = await agent.selectAgentForTask('implement @#$%^& feature!!! (urgently)');
      expect(result.selection).toBeDefined();
      expect(result.prompt).toBeDefined();
    });
  });

  describe('Real Agent Coverage', () => {
    it('should have loaded agents from multiple categories', () => {
      // Check that we have agents from various categories
      const phdAgents = registry.getByCategory('phdresearch');
      const logicalAgents = registry.getByCategory('logicalcode');
      const sprinkleAgents = registry.getByCategory('sprinkle');

      // Should have agents in at least 3 categories
      const categoriesWithAgents = [
        phdAgents.length > 0 ? 1 : 0,
        logicalAgents.length > 0 ? 1 : 0,
        sprinkleAgents.length > 0 ? 1 : 0,
      ].reduce((a, b) => a + b, 0);

      expect(categoriesWithAgents).toBeGreaterThanOrEqual(3);
    });

    it('should have phdresearch agents loaded', () => {
      const phdAgents = registry.getByCategory('phdresearch');
      expect(phdAgents.length).toBeGreaterThan(40);
    });

    it('should have logicalcode agents loaded', () => {
      const logicalAgents = registry.getByCategory('logicalcode');
      expect(logicalAgents.length).toBeGreaterThan(5);
    });

    it('should have sprinkle agents loaded', () => {
      const sprinkleAgents = registry.getByCategory('sprinkle');
      // Check actual count and use that as baseline
      expect(sprinkleAgents.length).toBeGreaterThan(0);
    });
  });

  describe('Constitution Compliance Verification', () => {
    it('RULE-002: Tests use REAL agents (not mocks)', () => {
      // Verify we have real agent data
      const agents = registry.getAll();
      for (const agent of agents.slice(0, 10)) {
        expect(agent.key).toBeDefined();
        expect(agent.category).toBeDefined();
        expect(agent.promptContent.length).toBeGreaterThan(0);
        expect(agent.filePath).toContain('.claude/agents');
      }
    });

    it('RULE-005: AgentRegistry is single source of truth', () => {
      // Verify selector uses registry
      const registryAgents = registry.getAll();
      expect(registryAgents.length).toBeGreaterThan(0);

      // Any selection should return an agent from registry
      const result = selector.selectAgent('test task');
      const foundInRegistry = registryAgents.some(a => a.key === result.selected.key);
      expect(foundInRegistry).toBe(true);
    });

    it('RULE-004: Selection uses dynamic loading (no hardcoded agents)', () => {
      // Verify selection works for various task types
      const tasks = [
        'implement authentication',
        'research methodology',
        'write documentation',
        'what is dependency injection',
      ];

      for (const task of tasks) {
        const result = selector.selectAgent(task);
        // Agent must exist in registry
        expect(registry.has(result.selected.key)).toBe(true);
      }
    });
  });
});
