/**
 * Tests for PipelineConfigLoader
 * Validates REQ-PIPE-040 (support all 45+ agents)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineConfigLoader } from '../../../src/god-agent/cli/pipeline-loader.js';

describe('PipelineConfigLoader', () => {
  let loader: PipelineConfigLoader;

  beforeEach(() => {
    loader = new PipelineConfigLoader(process.cwd());
    loader.clearCache();
  });

  describe('loadPipelineConfig', () => {
    it('should load all agent definitions from agents directory', async () => {
      const config = await loader.loadPipelineConfig();

      expect(config.id).toBe('phd-research-pipeline');
      expect(config.name).toBe('PhD Research Pipeline');
      expect(config.agents).toBeDefined();
      expect(config.agents.length).toBeGreaterThan(0);
    });

    it('should support 45+ agents [REQ-PIPE-040]', async () => {
      const config = await loader.loadPipelineConfig();

      // Should have at least 45 agents
      expect(config.agents.length).toBeGreaterThanOrEqual(45);
    });

    it('should cache configuration on subsequent calls', async () => {
      const config1 = await loader.loadPipelineConfig();
      const config2 = await loader.loadPipelineConfig();

      expect(config1).toBe(config2); // Same reference (cached)
    });

    it('should sort agents by phase and order', async () => {
      const config = await loader.loadPipelineConfig();

      // Verify agents are sorted by phase first
      for (let i = 1; i < config.agents.length; i++) {
        const prev = config.agents[i - 1];
        const curr = config.agents[i];

        // Either phase is greater or same phase with greater order
        expect(
          curr.phase > prev.phase ||
          (curr.phase === prev.phase && curr.order >= prev.order)
        ).toBe(true);
      }
    });

    it('should have all 7 phases represented', async () => {
      const config = await loader.loadPipelineConfig();

      const phases = new Set(config.agents.map(a => a.phase));

      // Should have phases 1-7
      expect(phases.has(1)).toBe(true);
      expect(phases.has(2)).toBe(true);
      expect(phases.has(3)).toBe(true);
      expect(phases.has(4)).toBe(true);
      expect(phases.has(5)).toBe(true);
      expect(phases.has(6)).toBe(true);
      expect(phases.has(7)).toBe(true);
    });
  });

  describe('parseAgentDefinition', () => {
    it('should extract agent key from filename', async () => {
      const config = await loader.loadPipelineConfig();

      // Find step-back-analyzer
      const agent = config.agents.find(a => a.key === 'step-back-analyzer');
      expect(agent).toBeDefined();
      expect(agent?.key).toBe('step-back-analyzer');
    });

    it('should extract description from markdown content', async () => {
      const config = await loader.loadPipelineConfig();

      const agent = config.agents.find(a => a.key === 'step-back-analyzer');
      expect(agent?.description).toBeDefined();
      expect(agent?.description.length).toBeGreaterThan(0);
    });

    it('should set default timeout when not specified', async () => {
      const config = await loader.loadPipelineConfig();

      // All agents should have a timeout
      for (const agent of config.agents) {
        expect(agent.timeout).toBeGreaterThan(0);
      }
    });
  });

  describe('getAgentByIndex', () => {
    it('should return agent at specified index', async () => {
      const agent = await loader.getAgentByIndex(0);

      expect(agent).toBeDefined();
      expect(agent.key).toBeDefined();
      expect(agent.phase).toBe(1); // First agent should be Phase 1
    });

    it('should throw error for invalid index', async () => {
      await expect(loader.getAgentByIndex(-1))
        .rejects.toThrow('Invalid agent index');

      await expect(loader.getAgentByIndex(999))
        .rejects.toThrow('Invalid agent index');
    });
  });

  describe('getAgentByKey', () => {
    it('should return agent with matching key', async () => {
      const agent = await loader.getAgentByKey('step-back-analyzer');

      expect(agent).toBeDefined();
      expect(agent?.key).toBe('step-back-analyzer');
    });

    it('should return undefined for non-existent key', async () => {
      const agent = await loader.getAgentByKey('nonexistent-agent');

      expect(agent).toBeUndefined();
    });
  });

  describe('isPhase6Agent', () => {
    it('should return true for Phase 6 agents', async () => {
      const config = await loader.loadPipelineConfig();

      const introWriter = config.agents.find(a => a.key === 'introduction-writer');
      expect(introWriter).toBeDefined();
      if (introWriter) {
        expect(loader.isPhase6Agent(introWriter)).toBe(true);
      }
    });

    it('should return false for non-Phase 6 agents', async () => {
      const config = await loader.loadPipelineConfig();

      const stepBack = config.agents.find(a => a.key === 'step-back-analyzer');
      expect(stepBack).toBeDefined();
      if (stepBack) {
        expect(loader.isPhase6Agent(stepBack)).toBe(false);
      }
    });
  });

  describe('getAgentsForPhase', () => {
    it('should return all agents for Phase 1', async () => {
      const agents = await loader.getAgentsForPhase(1);

      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.phase).toBe(1);
      }
    });

    it('should return all agents for Phase 6 (Writing)', async () => {
      const agents = await loader.getAgentsForPhase(6);

      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.phase).toBe(6);
      }
    });

    it('should return all agents for Phase 7 (Validation)', async () => {
      const agents = await loader.getAgentsForPhase(7);

      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.phase).toBe(7);
      }
    });

    it('should return empty array for non-existent phase', async () => {
      const agents = await loader.getAgentsForPhase(99);

      expect(agents).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should force reload on next call', async () => {
      const config1 = await loader.loadPipelineConfig();
      loader.clearCache();
      const config2 = await loader.loadPipelineConfig();

      // Different references after cache clear
      expect(config1).not.toBe(config2);
      // But same content
      expect(config1.agents.length).toBe(config2.agents.length);
    });
  });

  describe('agent properties', () => {
    it('should have required properties on all agents', async () => {
      const config = await loader.loadPipelineConfig();

      for (const agent of config.agents) {
        expect(agent.key).toBeDefined();
        expect(agent.name).toBeDefined();
        expect(agent.phase).toBeGreaterThanOrEqual(1);
        expect(agent.phase).toBeLessThanOrEqual(7);
        expect(agent.order).toBeDefined();
        expect(agent.description).toBeDefined();
        expect(Array.isArray(agent.dependencies)).toBe(true);
        expect(typeof agent.timeout).toBe('number');
        expect(typeof agent.critical).toBe('boolean');
        expect(Array.isArray(agent.expectedOutputs)).toBe(true);
        expect(Array.isArray(agent.inputs)).toBe(true);
        expect(Array.isArray(agent.outputs)).toBe(true);
      }
    });
  });
});
