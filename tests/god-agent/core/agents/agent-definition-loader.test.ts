/**
 * Agent Definition Loader Tests
 * TASK-AGT-001 - Unit tests for YAML/MD parsing
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import {
  AgentDefinitionLoader,
  parseFrontmatter,
} from '../../../../src/god-agent/core/agents/agent-definition-loader.js';
import { AgentCategoryScanner } from '../../../../src/god-agent/core/agents/agent-category-scanner.js';
import { AgentRegistry, createAgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';

const AGENTS_BASE_PATH = join(process.cwd(), '.claude/agents');
const PHDRESEARCH_PATH = join(AGENTS_BASE_PATH, 'phdresearch');

describe('AgentDefinitionLoader', () => {
  let loader: AgentDefinitionLoader;

  beforeAll(() => {
    loader = new AgentDefinitionLoader({
      basePath: AGENTS_BASE_PATH,
      verbose: false,
    });
  });

  describe('parseFrontmatter', () => {
    it('should parse YAML frontmatter from markdown content', () => {
      const content = `---
name: test-agent
description: A test agent
priority: high
---

# Test Agent

This is the prompt content.
`;
      const result = parseFrontmatter(content);

      expect(result.frontmatter).not.toBeNull();
      expect(result.frontmatter?.name).toBe('test-agent');
      expect(result.frontmatter?.description).toBe('A test agent');
      expect(result.frontmatter?.priority).toBe('high');
      expect(result.body).toContain('# Test Agent');
      expect(result.body).toContain('This is the prompt content.');
    });

    it('should return null frontmatter for content without delimiters', () => {
      const content = `# No Frontmatter

Just content here.
`;
      const result = parseFrontmatter(content);

      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe(content);
    });

    it('should parse hooks with multiline content', () => {
      const content = `---
name: hook-agent
description: Agent with hooks
hooks:
  pre: |
    echo "Starting"
    npx claude-flow memory retrieve --key "test"
  post: |
    echo "Done"
    npx claude-flow memory store --namespace "test" --key "result"
---

Prompt content.
`;
      const result = parseFrontmatter(content);

      expect(result.frontmatter).not.toBeNull();
      expect(result.frontmatter?.hooks?.pre).toContain('echo "Starting"');
      expect(result.frontmatter?.hooks?.pre).toContain('memory retrieve');
      expect(result.frontmatter?.hooks?.post).toContain('memory store');
    });
  });

  describe('loadOne', () => {
    it('should load step-back-analyzer.md successfully', async () => {
      const filePath = join(PHDRESEARCH_PATH, 'step-back-analyzer.md');
      const def = await loader.loadOne(filePath, 'phdresearch');

      expect(def).not.toBeNull();
      expect(def?.key).toBe('step-back-analyzer');
      expect(def?.category).toBe('phdresearch');
      expect(def?.frontmatter.name).toBe('step-back-analyzer');
      expect(def?.frontmatter.priority).toBe('critical');
      expect(def?.promptContent.length).toBeGreaterThan(100);
    });

    it('should load adversarial-reviewer.md successfully', async () => {
      const filePath = join(PHDRESEARCH_PATH, 'adversarial-reviewer.md');
      const def = await loader.loadOne(filePath, 'phdresearch');

      expect(def).not.toBeNull();
      expect(def?.key).toBe('adversarial-reviewer');
      // Case-insensitive check for "red team" or "Red team"
      expect(def?.frontmatter.description.toLowerCase()).toContain('red team');
    });
  });

  describe('loadAll', () => {
    it('should load all agents from phdresearch category', async () => {
      const definitions = await loader.loadAll(PHDRESEARCH_PATH, 'phdresearch');

      expect(definitions.length).toBeGreaterThanOrEqual(40);

      // Check for specific agents
      const keys = definitions.map(d => d.key);
      expect(keys).toContain('step-back-analyzer');
      expect(keys).toContain('adversarial-reviewer');
      expect(keys).toContain('contradiction-analyzer');
      expect(keys).toContain('introduction-writer');
    });
  });
});

describe('AgentCategoryScanner', () => {
  let scanner: AgentCategoryScanner;

  beforeAll(() => {
    scanner = new AgentCategoryScanner({ verbose: false });
  });

  describe('scanCategories', () => {
    it('should discover multiple category directories', async () => {
      const categories = await scanner.scanCategories(AGENTS_BASE_PATH);

      expect(categories.length).toBeGreaterThanOrEqual(5);

      // Check for expected categories
      const names = categories.map(c => c.name);
      expect(names).toContain('phdresearch');
    });

    it('should count agents per category', async () => {
      const categories = await scanner.scanCategories(AGENTS_BASE_PATH);
      const phdresearch = categories.find(c => c.name === 'phdresearch');

      expect(phdresearch).toBeDefined();
      expect(phdresearch?.agentCount).toBeGreaterThanOrEqual(40);
    });

    it('should sort categories by agent count (descending)', async () => {
      const categories = await scanner.scanCategories(AGENTS_BASE_PATH);

      for (let i = 1; i < categories.length; i++) {
        expect(categories[i - 1].agentCount).toBeGreaterThanOrEqual(
          categories[i].agentCount
        );
      }
    });
  });
});

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeAll(async () => {
    registry = await createAgentRegistry(AGENTS_BASE_PATH, { verbose: false });
  });

  describe('initialization', () => {
    it('should load agents from all categories', () => {
      expect(registry.size).toBeGreaterThanOrEqual(40);
      expect(registry.isInitialized).toBe(true);
    });

    it('should have multiple categories', () => {
      const categories = registry.getCategoryNames();
      expect(categories.length).toBeGreaterThanOrEqual(1);
      expect(categories).toContain('phdresearch');
    });
  });

  describe('getByKey', () => {
    it('should return agent by key', () => {
      const agent = registry.getByKey('step-back-analyzer');

      expect(agent).toBeDefined();
      expect(agent?.key).toBe('step-back-analyzer');
      expect(agent?.frontmatter.name).toBe('step-back-analyzer');
    });

    it('should return undefined for unknown key', () => {
      const agent = registry.getByKey('non-existent-agent');
      expect(agent).toBeUndefined();
    });
  });

  describe('getByCategory', () => {
    it('should return all agents in a category', () => {
      const agents = registry.getByCategory('phdresearch');

      expect(agents.length).toBeGreaterThanOrEqual(40);
      agents.forEach(a => {
        expect(a.category).toBe('phdresearch');
      });
    });

    it('should return empty array for unknown category', () => {
      const agents = registry.getByCategory('non-existent-category');
      expect(agents).toEqual([]);
    });
  });

  describe('validatePipelineAgents', () => {
    it('should validate when all agents exist', () => {
      const result = registry.validatePipelineAgents([
        'step-back-analyzer',
        'adversarial-reviewer',
        'contradiction-analyzer',
      ]);

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should report missing agents', () => {
      const result = registry.validatePipelineAgents([
        'step-back-analyzer',
        'non-existent-agent',
        'another-missing-agent',
      ]);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('non-existent-agent');
      expect(result.missing).toContain('another-missing-agent');
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', () => {
      const stats = registry.getStats();

      expect(stats.totalAgents).toBeGreaterThanOrEqual(40);
      expect(stats.totalCategories).toBeGreaterThanOrEqual(1);
      expect(stats.categoryCounts['phdresearch']).toBeGreaterThanOrEqual(40);
      expect(stats.initializedAt).toBeGreaterThan(0);
    });
  });

  describe('searchByName', () => {
    it('should find agents by name pattern', () => {
      const results = registry.searchByName('analyzer');

      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => {
        const matchesKey = r.key.toLowerCase().includes('analyzer');
        const matchesName = r.frontmatter.name.toLowerCase().includes('analyzer');
        const matchesDesc = r.frontmatter.description.toLowerCase().includes('analyzer');
        expect(matchesKey || matchesName || matchesDesc).toBe(true);
      });
    });
  });

  describe('getByPriority', () => {
    it('should return critical priority agents', () => {
      const criticalAgents = registry.getByPriority('critical');

      expect(criticalAgents.length).toBeGreaterThan(0);
      criticalAgents.forEach(a => {
        expect(a.frontmatter.priority).toBe('critical');
      });
    });
  });
});
