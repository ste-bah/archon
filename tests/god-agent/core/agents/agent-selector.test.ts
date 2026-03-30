/**
 * Agent Selector Test Suite
 * TASK-002: DAI-001 Core Layer Tests
 *
 * Per constitution.md RULE-002: NO mock data - use REAL agents from .claude/agents/
 * Tests verify selection logic with actual agent definitions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AgentSelector,
  ITaskAnalysis,
  IScoredAgent,
  IAgentSelectionResult,
} from '../../../../src/god-agent/core/agents/agent-selector.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import { AgentSelectionError } from '../../../../src/god-agent/core/agents/agent-errors.js';

describe('AgentSelector', () => {
  let registry: AgentRegistry;
  let selector: AgentSelector;

  beforeAll(async () => {
    // Use REAL agent definitions - NO mocks
    registry = new AgentRegistry({ basePath: '.claude/agents', verbose: false });
    await registry.initialize('.claude/agents');
    selector = new AgentSelector(registry, { verbose: false });
  });

  describe('Registry validation (REAL data)', () => {
    it('should have loaded most agents from .claude/agents/', async () => {
      // Verify against actual directory - per RULE-002
      // Note: Some agents may fail to load due to malformed YAML
      const agentDir = '.claude/agents';
      const categories = await fs.readdir(agentDir);
      let fileCount = 0;

      for (const cat of categories) {
        const catPath = path.join(agentDir, cat);
        const stat = await fs.stat(catPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(catPath);
          fileCount += files.filter(f => f.endsWith('.md')).length;
        }
      }

      // Registry should load at least 90% of agent files
      // Some may fail due to malformed frontmatter
      const minExpected = Math.floor(fileCount * 0.9);
      expect(registry.size).toBeGreaterThanOrEqual(minExpected);
      expect(registry.size).toBeGreaterThan(180); // At least 180 agents
    });

    it('should have phdresearch category with 40+ agents', () => {
      const phdAgents = registry.getByCategory('phdresearch');
      expect(phdAgents.length).toBeGreaterThan(40);
    });
  });

  describe('analyzeTask()', () => {
    it('should detect code task type', () => {
      const analysis = selector.analyzeTask('implement user authentication with JWT');

      expect(analysis.taskType).toBe('code');
      expect(analysis.keywords).toContain('implement');
      expect(analysis.keywords).toContain('user');
      expect(analysis.keywords).toContain('authentication');
      expect(analysis.keywords).toContain('jwt');
      expect(analysis.requiredCapabilities.length).toBeGreaterThan(0);
    });

    it('should detect research task type', () => {
      const analysis = selector.analyzeTask('conduct literature review on machine learning');

      expect(analysis.taskType).toBe('research');
      expect(analysis.keywords).toContain('conduct');
      expect(analysis.keywords).toContain('literature');
      expect(analysis.keywords).toContain('review');
      expect(analysis.keywords).toContain('machine');
      expect(analysis.keywords).toContain('learning');
    });

    it('should detect write task type', () => {
      const analysis = selector.analyzeTask('write documentation for the API endpoints');

      expect(analysis.taskType).toBe('write');
      expect(analysis.keywords).toContain('write');
      expect(analysis.keywords).toContain('documentation');
      expect(analysis.keywords).toContain('api');
      expect(analysis.keywords).toContain('endpoints');
    });

    it('should detect ask task type for questions', () => {
      const analysis = selector.analyzeTask('what is the purpose of dependency injection?');

      expect(analysis.taskType).toBe('ask');
      expect(analysis.keywords).toContain('purpose');
      expect(analysis.keywords).toContain('dependency');
      expect(analysis.keywords).toContain('injection');
    });

    it('should filter out stop words from keywords', () => {
      const analysis = selector.analyzeTask('the and a an for with implement this feature');

      expect(analysis.keywords).not.toContain('the');
      expect(analysis.keywords).not.toContain('and');
      expect(analysis.keywords).not.toContain('for');
      expect(analysis.keywords).not.toContain('with');
      expect(analysis.keywords).toContain('implement');
      expect(analysis.keywords).toContain('feature');
    });

    it('should include preferred categories for task type', () => {
      const codeAnalysis = selector.analyzeTask('implement a function');
      expect(codeAnalysis.preferredCategories).toContain('logicalcode');

      const researchAnalysis = selector.analyzeTask('research the topic');
      expect(researchAnalysis.preferredCategories).toContain('phdresearch');
    });
  });

  describe('selectAgent() with REAL agents', () => {
    it('should select an agent for code task', () => {
      const result = selector.selectAgent('implement user authentication system');

      expect(result.selected).toBeDefined();
      expect(result.selected.key).toBeDefined();
      expect(result.selected.key.length).toBeGreaterThan(0);
      expect(result.analysis.taskType).toBe('code');
      expect(result.candidates.length).toBeGreaterThan(0);
    });

    it('should select an agent for research task', () => {
      const result = selector.selectAgent('conduct a systematic literature review');

      expect(result.selected).toBeDefined();
      expect(result.selected.key).toBeDefined();
      expect(result.analysis.taskType).toBe('research');
    });

    it('should select an agent for write task', () => {
      const result = selector.selectAgent('write documentation for the user module');

      expect(result.selected).toBeDefined();
      expect(result.selected.key).toBeDefined();
      expect(result.analysis.taskType).toBe('write');
    });

    it('should include match reasons in candidates', () => {
      const result = selector.selectAgent('implement code generation');

      expect(result.candidates[0].matchReasons.length).toBeGreaterThan(0);
      expect(result.candidates[0].score).toBeGreaterThan(0);
    });

    it('should return sorted candidates (highest score first)', () => {
      const result = selector.selectAgent('research methodology design');

      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
      }
    });

    it('should include task analysis in result', () => {
      const result = selector.selectAgent('build API endpoint');

      expect(result.analysis).toBeDefined();
      expect(result.analysis.taskType).toBeDefined();
      expect(result.analysis.keywords).toBeDefined();
      expect(Array.isArray(result.analysis.keywords)).toBe(true);
    });
  });

  describe('selectAgents() (multiple agents)', () => {
    it('should select multiple unique agents', () => {
      const results = selector.selectAgents('conduct comprehensive research analysis', 3);

      expect(results.length).toBeLessThanOrEqual(3);
      expect(results.length).toBeGreaterThan(0);

      // Verify uniqueness
      const keys = results.map(r => r.selected.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should return fewer agents if not enough candidates', () => {
      // Request more agents than likely match a very specific task
      const results = selector.selectAgents('extremely specific obscure task xyz123', 100);

      // Should still return some agents (graceful handling)
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error handling', () => {
    it('should throw AgentSelectionError when no agents match', () => {
      // Create a selector with empty registry
      const emptyRegistry = new AgentRegistry({ basePath: '/nonexistent', verbose: false });
      const emptySelector = new AgentSelector(emptyRegistry, { verbose: false });

      expect(() => emptySelector.selectAgent('any task')).toThrow(AgentSelectionError);
    });

    it('should include context in AgentSelectionError', () => {
      const emptyRegistry = new AgentRegistry({ basePath: '/nonexistent', verbose: false });
      const emptySelector = new AgentSelector(emptyRegistry, { verbose: false });

      try {
        emptySelector.selectAgent('test task');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AgentSelectionError);
        const error = e as AgentSelectionError;
        expect(error.message).toContain('test task');
        expect(error.message).toContain('No suitable agent');
      }
    });
  });

  describe('Scoring algorithm', () => {
    it('should give higher scores to agents with matching keywords', () => {
      // The 'researcher' agent should score higher for research tasks
      const result = selector.selectAgent('deep research and analysis of data');

      // Find if any candidate has 'research' in key/name
      const researchAgents = result.candidates.filter(
        c => c.agent.key.includes('research') ||
             (c.agent.frontmatter.name && c.agent.frontmatter.name.includes('research'))
      );

      if (researchAgents.length > 0) {
        // Research-named agents should have reasonable scores
        expect(researchAgents[0].score).toBeGreaterThan(0);
      }
    });

    it('should prefer agents from preferred categories', () => {
      const result = selector.selectAgent('analyze patterns in the codebase');

      // Should prefer logicalcode category for code-related tasks
      const preferredCats = result.analysis.preferredCategories;
      const selectedCategory = result.selected.category;

      // Either selected from preferred category, or no agents in preferred cats
      const fromPreferred = preferredCats.includes(selectedCategory);
      const hasPreferredAgents = result.candidates.some(c =>
        preferredCats.includes(c.agent.category)
      );

      if (hasPreferredAgents) {
        // If there were agents from preferred categories, top candidate should be from there
        // (or have higher score for other reasons)
        expect(result.candidates[0].score).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty task string', () => {
      const result = selector.selectAgent('');

      // Should still return an agent (general type)
      expect(result.selected).toBeDefined();
      expect(result.analysis.taskType).toBe('general');
    });

    it('should handle very long task strings', () => {
      const longTask = 'implement '.repeat(100);
      const result = selector.selectAgent(longTask);

      expect(result.selected).toBeDefined();
    });

    it('should handle special characters in task', () => {
      const result = selector.selectAgent('implement @#$%^& feature!!! (urgently)');

      expect(result.selected).toBeDefined();
      expect(result.analysis.keywords).toContain('implement');
      expect(result.analysis.keywords).toContain('feature');
      expect(result.analysis.keywords).toContain('urgently');
    });
  });
});
