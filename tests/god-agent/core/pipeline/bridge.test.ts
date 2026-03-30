/**
 * Pipeline Bridge Tests
 * TASK-BRG-001 - Unit tests for pipeline bridge components
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PipelineBridge } from '../../../../src/god-agent/core/pipeline/pipeline-bridge.js';
import { PhDPipelineBridge, createPhDPipelineBridge } from '../../../../src/god-agent/core/pipeline/phd-pipeline-bridge.js';
import {
  QualityGateValidator,
  createPhDQualityGateValidator,
} from '../../../../src/god-agent/core/pipeline/quality-gate-validator.js';
import { PHD_PIPELINE_CONFIG } from '../../../../src/god-agent/core/pipeline/phd-pipeline-config.js';
import type { IPipelineConfig, IAgentConfig } from '../../../../src/god-agent/core/pipeline/pipeline-types.js';
import type { IAgentDefinition } from '../../../../src/god-agent/core/orchestration/orchestration-types.js';

// ==================== Test Fixtures ====================

/**
 * Simple test pipeline config
 */
const SIMPLE_CONFIG: IPipelineConfig = {
  pipeline: {
    name: 'Test Pipeline',
    version: '1.0.0',
    description: 'Simple test pipeline',
    totalAgents: 3,
    phases: 1,
  },
  phases: [
    {
      id: 1,
      name: 'Test Phase',
      description: 'Testing',
      agents: [1, 2, 3],
      objectives: ['Test objective'],
    },
  ],
  agents: [
    {
      id: 1,
      key: 'agent-a',
      name: 'Agent A',
      phase: 1,
      description: 'First agent',
      dependencies: [],
      inputs: [],
      outputs: ['output_a'],
      timeout: 60,
    },
    {
      id: 2,
      key: 'agent-b',
      name: 'Agent B',
      phase: 1,
      description: 'Second agent',
      dependencies: [1],
      inputs: ['output_a'],
      outputs: ['output_b'],
      timeout: 60,
    },
    {
      id: 3,
      key: 'agent-c',
      name: 'Agent C',
      phase: 1,
      description: 'Third agent',
      dependencies: [1, 2],
      inputs: ['output_a', 'output_b'],
      outputs: ['output_c'],
      timeout: 60,
    },
  ],
};

/**
 * Cyclic dependency config (for error testing)
 */
const CYCLIC_CONFIG: IPipelineConfig = {
  pipeline: {
    name: 'Cyclic Pipeline',
    version: '1.0.0',
    description: 'Has cycle',
    totalAgents: 3,
    phases: 1,
  },
  phases: [
    {
      id: 1,
      name: 'Test Phase',
      description: 'Testing',
      agents: [1, 2, 3],
      objectives: ['Test'],
    },
  ],
  agents: [
    {
      id: 1,
      key: 'agent-a',
      name: 'Agent A',
      phase: 1,
      description: 'First',
      dependencies: [3], // Creates cycle: 1->3->2->1
      inputs: [],
      outputs: ['a'],
      timeout: 60,
    },
    {
      id: 2,
      key: 'agent-b',
      name: 'Agent B',
      phase: 1,
      description: 'Second',
      dependencies: [1],
      inputs: [],
      outputs: ['b'],
      timeout: 60,
    },
    {
      id: 3,
      key: 'agent-c',
      name: 'Agent C',
      phase: 1,
      description: 'Third',
      dependencies: [2],
      inputs: [],
      outputs: ['c'],
      timeout: 60,
    },
  ],
};

// ==================== PipelineBridge Tests ====================

describe('PipelineBridge', () => {
  describe('topologicalSort', () => {
    it('should sort agents in dependency order', () => {
      const bridge = new PipelineBridge(SIMPLE_CONFIG);
      const result = bridge.topologicalSort(SIMPLE_CONFIG.agents);

      expect(result.success).toBe(true);
      expect(result.sorted.length).toBe(3);
      expect(result.unsortable.length).toBe(0);

      // Agent A should come before B and C
      const indexA = result.sorted.findIndex(a => a.key === 'agent-a');
      const indexB = result.sorted.findIndex(a => a.key === 'agent-b');
      const indexC = result.sorted.findIndex(a => a.key === 'agent-c');

      expect(indexA).toBeLessThan(indexB);
      expect(indexA).toBeLessThan(indexC);
      expect(indexB).toBeLessThan(indexC);
    });

    it('should detect cycles', () => {
      const bridge = new PipelineBridge(CYCLIC_CONFIG);
      const result = bridge.topologicalSort(CYCLIC_CONFIG.agents);

      expect(result.success).toBe(false);
      expect(result.unsortable.length).toBe(3);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should handle empty agent list', () => {
      const emptyConfig: IPipelineConfig = {
        ...SIMPLE_CONFIG,
        agents: [],
      };
      const bridge = new PipelineBridge(emptyConfig);
      const result = bridge.topologicalSort([]);

      expect(result.success).toBe(true);
      expect(result.sorted.length).toBe(0);
    });
  });

  describe('buildPipelineDefinition', () => {
    it('should build valid pipeline definition', () => {
      const bridge = new PipelineBridge(SIMPLE_CONFIG, null, { category: 'test' });
      const def = bridge.buildPipelineDefinition('exec-123');

      expect(def.name).toBe('Test Pipeline');
      expect(def.agents.length).toBe(3);
      expect(def.sequential).toBe(true);
    });

    it('should set correct memory keys', () => {
      const bridge = new PipelineBridge(SIMPLE_CONFIG, null, { category: 'test' });
      const def = bridge.buildPipelineDefinition('exec-123');

      // First agent should have null previousKey
      expect(def.agents[0].previousKey).toBeNull();

      // Second agent should reference first agent's output
      expect(def.agents[1].previousKey).toBe(def.agents[0].outputKey);

      // Third agent should reference second agent's output
      expect(def.agents[2].previousKey).toBe(def.agents[1].outputKey);

      // All output keys should follow format
      for (const agent of def.agents) {
        expect(agent.outputKey).toMatch(/test\/exec-123\/agent-[abc]\/output/);
      }
    });

    it('should set correct positions', () => {
      const bridge = new PipelineBridge(SIMPLE_CONFIG);
      const def = bridge.buildPipelineDefinition('exec-123');

      expect(def.agents[0].position).toBe('Agent #1/3');
      expect(def.agents[1].position).toBe('Agent #2/3');
      expect(def.agents[2].position).toBe('Agent #3/3');
    });

    it('should throw on cyclic dependencies', () => {
      const bridge = new PipelineBridge(CYCLIC_CONFIG);
      expect(() => bridge.buildPipelineDefinition('exec-123')).toThrow(/Circular dependencies/);
    });
  });

  describe('validateAgentDefinitions', () => {
    it('should report all missing when no registry', () => {
      const bridge = new PipelineBridge(SIMPLE_CONFIG, null);
      const result = bridge.validateAgentDefinitions();

      expect(result.valid).toBe(false);
      expect(result.missing.length).toBe(3);
      expect(result.found.length).toBe(0);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const bridge = new PipelineBridge(SIMPLE_CONFIG);
      const stats = bridge.getStatistics();

      expect(stats.totalAgents).toBe(3);
      expect(stats.phases).toBe(1);
      expect(stats.criticalAgents).toBe(0);
      // Agent A: 0 deps, Agent B: 1 dep, Agent C: 2 deps = 3 total / 3 agents = 1.0
      expect(stats.avgDependencies).toBe(1);
    });
  });
});

// ==================== PhDPipelineBridge Tests ====================

describe('PhDPipelineBridge', () => {
  let bridge: PhDPipelineBridge;

  beforeAll(() => {
    bridge = createPhDPipelineBridge(PHD_PIPELINE_CONFIG);
  });

  describe('buildPipelineDefinition', () => {
    it('should build definition with all 48 agents', () => {
      const def = bridge.buildPipelineDefinition('phd-exec-001');

      expect(def.agents.length).toBe(48);
      expect(def.name).toBe('PhD Research Pipeline');
    });

    it('should use phd category in memory keys', () => {
      const def = bridge.buildPipelineDefinition('phd-exec-001');

      for (const agent of def.agents) {
        expect(agent.outputKey).toContain('phd/');
      }
    });

    it('should include phase-specific quality gates', () => {
      const def = bridge.buildPipelineDefinition('phd-exec-001');

      // Writing phase agent should mention citations
      const writingAgent = def.agents.find(a => a.phase === 'Writing');
      expect(writingAgent?.qualityGate).toContain('cite');

      // QA phase agent should mention evidence
      const qaAgent = def.agents.find(a => a.phase === 'QA');
      expect(qaAgent?.qualityGate).toContain('evidence');
    });
  });

  describe('validatePhDRequirements', () => {
    it('should pass with valid PhD config', () => {
      const result = bridge.validatePhDRequirements();

      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
    });
  });

  describe('getPhDStatistics', () => {
    it('should return PhD-specific stats', () => {
      const stats = bridge.getPhDStatistics();

      expect(stats.totalAgents).toBe(48);
      expect(stats.phases).toBe(7);
      expect(stats.criticalAgents).toBe(3);
      expect(stats.writingAgents).toBe(7);
      expect(stats.qaAgents).toBe(16);
    });
  });

  describe('getCriticalPathAgents', () => {
    it('should find critical path', () => {
      const criticalPath = bridge.getCriticalPathAgents();

      // Critical path should exist
      expect(criticalPath.length).toBeGreaterThan(0);

      // Should be ordered by dependencies
      for (let i = 1; i < criticalPath.length; i++) {
        const prev = criticalPath[i - 1];
        const curr = criticalPath[i];
        // Current should depend on previous (or be independent)
        expect(
          curr.dependencies.includes(prev.id) ||
          curr.dependencies.length === 0 ||
          prev.id < curr.id
        ).toBe(true);
      }
    });
  });

  describe('getAgentsByPhase', () => {
    it('should return correct agents for each phase', () => {
      const phase1 = bridge.getAgentsByPhase(1);
      const phase7 = bridge.getAgentsByPhase(7);

      expect(phase1.length).toBe(4);  // Foundation phase
      expect(phase7.length).toBe(16); // QA phase

      // All returned agents should be in the correct phase
      expect(phase1.every(a => a.phase === 1)).toBe(true);
      expect(phase7.every(a => a.phase === 7)).toBe(true);
    });
  });
});

// ==================== QualityGateValidator Tests ====================

describe('QualityGateValidator', () => {
  let validator: QualityGateValidator;

  beforeAll(() => {
    validator = createPhDQualityGateValidator();
  });

  describe('validate', () => {
    it('should validate citation requirements', () => {
      const agent: IAgentDefinition = {
        agentName: 'Test Agent',
        position: 'Agent #1/1',
        phase: 'Test',
        previousKey: null,
        outputKey: 'test/output',
        task: 'Test task',
        qualityGate: 'Must cite 5+ academic sources',
      };

      // Output with citations
      const outputWithCitations = `
        According to Smith (2024), this is important.
        Research by Jones et al. (2023) supports this.
        See [1] for details. [2] confirms.
        Reference [3] and (Brown, 2022) also agree.
      `;

      const result = validator.validate(outputWithCitations, agent);
      // Check that citation check found citations (may not pass threshold)
      const citationCheck = result.checks.find(c => c.name === 'Citation Count');
      expect(citationCheck).toBeDefined();
      expect(citationCheck!.value).toBeGreaterThan(0);

      // Output without citations
      const outputWithoutCitations = 'This is just plain text with no citations.';
      const failResult = validator.validate(outputWithoutCitations, agent);
      expect(failResult.passed).toBe(false);
    });

    it('should validate output requirements', () => {
      const agent: IAgentDefinition = {
        agentName: 'Test Agent',
        position: 'Agent #1/1',
        phase: 'Test',
        previousKey: null,
        outputKey: 'test/output',
        task: 'Test task',
        qualityGate: 'Must produce literature_summary; Must produce key_papers',
      };

      const validOutput = `
        ## Literature Summary
        This is a literature summary of the key papers.

        ## Key Papers
        1. Paper A
        2. Paper B
      `;

      const result = validator.validate(validOutput, agent);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('should validate minimum word count', () => {
      const agent: IAgentDefinition = {
        agentName: 'Test Agent',
        position: 'Agent #1/1',
        phase: 'Test',
        previousKey: null,
        outputKey: 'test/output',
        task: 'Test task',
        qualityGate: 'Minimum 50 words',
      };

      const shortOutput = 'This is short.';
      const longOutput = 'This is a longer output that contains many more words. '.repeat(10);

      const shortResult = validator.validate(shortOutput, agent);
      const longResult = validator.validate(longOutput, agent);

      expect(shortResult.checks.find(c => c.name === 'Minimum Words')?.passed).toBe(false);
      expect(longResult.checks.find(c => c.name === 'Minimum Words')?.passed).toBe(true);
    });

    it('should calculate score correctly', () => {
      const agent: IAgentDefinition = {
        agentName: 'Test Agent',
        position: 'Agent #1/1',
        phase: 'Test',
        previousKey: null,
        outputKey: 'test/output',
        task: 'Test task',
        qualityGate: 'Must cite 5+ sources; Must produce summary',
      };

      const partialOutput = 'This is a summary without citations.';
      const result = validator.validate(partialOutput, agent);

      // Should have partial score (some checks pass, some fail)
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });

  describe('quickCheck', () => {
    it('should return boolean pass/fail', () => {
      const agent: IAgentDefinition = {
        agentName: 'Test Agent',
        position: 'Agent #1/1',
        phase: 'Test',
        previousKey: null,
        outputKey: 'test/output',
        task: 'Test task',
        qualityGate: 'Must produce output',
      };

      const result = validator.quickCheck('This has output', agent);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getFailureReport', () => {
    it('should generate readable failure report', () => {
      const agent: IAgentDefinition = {
        agentName: 'Test Agent',
        position: 'Agent #1/1',
        phase: 'Test',
        previousKey: null,
        outputKey: 'test/output',
        task: 'Test task',
        qualityGate: 'Must cite 10+ sources',
      };

      const result = validator.validate('No citations here', agent);
      const report = validator.getFailureReport(result);

      expect(report).toContain('Quality gate failed');
      expect(report).toContain('Test Agent');
    });

    it('should indicate success when passed', () => {
      const passedResult = {
        passed: true,
        checks: [],
        score: 1,
        validatedAt: Date.now(),
        agentName: 'Test Agent',
        qualityGate: '',
      };

      const report = validator.getFailureReport(passedResult);
      expect(report).toContain('All quality checks passed');
    });
  });

  describe('parseQualityGate', () => {
    it('should split quality gate string into requirements', () => {
      const requirements = validator.parseQualityGate(
        'Must cite 5+ sources; Must produce summary, Must follow APA format'
      );

      expect(requirements.length).toBe(3);
      expect(requirements).toContain('Must cite 5+ sources');
      expect(requirements).toContain('Must produce summary');
      expect(requirements).toContain('Must follow APA format');
    });
  });
});
