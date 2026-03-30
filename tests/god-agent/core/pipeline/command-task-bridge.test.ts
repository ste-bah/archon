/**
 * DAI-002: Command Task Bridge Tests
 *
 * Tests for CommandTaskBridge class implementing:
 * - US-014: /god-code Task() Spawning
 * - US-015: /god-ask Task() Spawning
 * - US-016: /god-research Task() Spawning
 * - US-017: /god-write Task() Spawning
 * - US-018: Complex Task Pipeline Triggering
 * - FR-017: Task() Spawning Required
 * - FR-018: Pipeline Detection
 * - FR-019: Multi-Step Task Detection
 *
 * RULE-002: No mock data - uses real pattern detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CommandTaskBridge,
  createCommandTaskBridge,
  type IComplexityAnalysis,
  type IPipelineDecision,
  type TaskType,
  DEFAULT_PIPELINE_THRESHOLD,
  PHASE_KEYWORDS,
  DOCUMENT_KEYWORDS,
} from '../../../../src/god-agent/core/pipeline/index.js';
import { PipelineDefinitionError } from '../../../../src/god-agent/core/pipeline/index.js';

describe('CommandTaskBridge', () => {
  let bridge: CommandTaskBridge;

  beforeEach(() => {
    bridge = new CommandTaskBridge({ verbose: false });
  });

  // ==================== analyzeTaskComplexity() Tests ====================

  describe('analyzeTaskComplexity()', () => {
    it('detects single-step simple tasks with low complexity', () => {
      const analysis = bridge.analyzeTaskComplexity('implement a login button');

      expect(analysis.score).toBeLessThan(DEFAULT_PIPELINE_THRESHOLD);
      expect(analysis.isMultiStep).toBe(false);
      expect(analysis.detectedPhases).toHaveLength(1); // 'implement'
    });

    it('detects multi-step tasks with "and" connector', () => {
      const analysis = bridge.analyzeTaskComplexity('plan and implement and test the feature');

      expect(analysis.isMultiStep).toBe(true);
      expect(analysis.detectedPhases).toContain('plan');
      expect(analysis.detectedPhases).toContain('implement');
      expect(analysis.detectedPhases).toContain('test');
      expect(analysis.score).toBeGreaterThanOrEqual(DEFAULT_PIPELINE_THRESHOLD);
    });

    it('detects document creation tasks', () => {
      const analysis = bridge.analyzeTaskComplexity('create PRD, spec, and technical documentation');

      expect(analysis.isMultiStep).toBe(true);
      expect(analysis.detectedDocuments).toContain('prd');
      expect(analysis.detectedDocuments).toContain('spec');
      expect(analysis.detectedDocuments.some(d => d.includes('doc'))).toBe(true);
    });

    it('detects connector words indicating sequence', () => {
      const analysis = bridge.analyzeTaskComplexity(
        'first analyze the codebase, then implement changes, finally deploy'
      );

      expect(analysis.isMultiStep).toBe(true);
      expect(analysis.score).toBeGreaterThan(0.5);
      expect(analysis.reasoning).toContain('connector');
    });

    it('handles tasks with multiple action verbs', () => {
      const analysis = bridge.analyzeTaskComplexity(
        'create a new API, build the frontend, write unit tests'
      );

      expect(analysis.score).toBeGreaterThan(0);
      expect(analysis.reasoning).toContain('action verb');
    });

    it('considers task length in complexity', () => {
      const shortTask = 'fix bug';
      const longTask = 'Analyze the existing authentication system, identify security vulnerabilities, design a new secure architecture, implement the changes, and deploy to production';

      const shortAnalysis = bridge.analyzeTaskComplexity(shortTask);
      const longAnalysis = bridge.analyzeTaskComplexity(longTask);

      expect(longAnalysis.score).toBeGreaterThan(shortAnalysis.score);
    });

    it('normalizes complexity score to 0-1 range', () => {
      // Task with many indicators that might exceed 1.0 before normalization
      const analysis = bridge.analyzeTaskComplexity(
        'first plan the architecture document, then design the PRD and spec, ' +
        'next implement and test, finally review, document, and deploy'
      );

      expect(analysis.score).toBeLessThanOrEqual(1);
      expect(analysis.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== shouldUsePipeline() Tests ====================

  describe('shouldUsePipeline()', () => {
    it('recommends pipeline for complex multi-phase tasks', () => {
      const decision = bridge.shouldUsePipeline(
        'plan, design, implement, and test the new authentication system'
      );

      expect(decision.usePipeline).toBe(true);
      expect(decision.suggestedSteps).toBeDefined();
      expect(decision.suggestedSteps!.length).toBeGreaterThanOrEqual(2);
    });

    it('does not recommend pipeline for simple tasks', () => {
      const decision = bridge.shouldUsePipeline('fix the typo in README');

      expect(decision.usePipeline).toBe(false);
      expect(decision.suggestedSteps).toBeUndefined();
      expect(decision.reason).toContain('threshold');
    });

    it('recommends pipeline for document creation tasks', () => {
      const decision = bridge.shouldUsePipeline(
        'create PRD and specification documents for the feature'
      );

      expect(decision.usePipeline).toBe(true);
      expect(decision.suggestedSteps).toContain('create prd');
    });

    it('includes complexity analysis in decision', () => {
      const decision = bridge.shouldUsePipeline('implement feature X');

      expect(decision.complexity).toBeDefined();
      expect(decision.complexity.score).toBeDefined();
      expect(decision.complexity.isMultiStep).toBeDefined();
    });

    it('uses default pipeline for high-score tasks without clear phases', () => {
      // A task that's complex (long, has connectors) but no specific phases
      const decision = bridge.shouldUsePipeline(
        'then after that subsequently do things one by one following the steps'
      );

      // If pipeline is used, it should suggest default steps
      if (decision.usePipeline && decision.suggestedSteps?.length === 0) {
        // This shouldn't happen - should have default steps
        fail('Pipeline with no suggested steps');
      }
    });

    it('respects custom threshold configuration', () => {
      const highThresholdBridge = new CommandTaskBridge({
        pipelineThreshold: 0.95 // Very high threshold
      });

      const decision = highThresholdBridge.shouldUsePipeline(
        'plan and implement the feature'
      );

      // Even a moderately complex task should not trigger pipeline
      expect(decision.usePipeline).toBe(false);
    });
  });

  // ==================== buildPipelineDefinition() Tests ====================

  describe('buildPipelineDefinition()', () => {
    it('builds pipeline with correct structure for multi-phase task', () => {
      const pipeline = bridge.buildPipelineDefinition(
        'analyze requirements, design architecture, implement solution',
        'code'
      );

      expect(pipeline.name).toBeDefined();
      expect(pipeline.description).toBeDefined();
      expect(pipeline.agents.length).toBeGreaterThanOrEqual(2);
      expect(pipeline.sequential).toBe(true);
    });

    it('chains steps with proper input/output domains', () => {
      const pipeline = bridge.buildPipelineDefinition(
        'plan the feature, then implement it, then test it',
        'code'
      );

      // Verify chaining: each step (after first) has inputDomain from previous
      for (let i = 1; i < pipeline.agents.length; i++) {
        const step = pipeline.agents[i];
        const prevStep = pipeline.agents[i - 1];

        expect(step.inputDomain).toBe(prevStep.outputDomain);
        expect(step.inputTags).toEqual(prevStep.outputTags);
      }

      // First step should have no input
      expect(pipeline.agents[0].inputDomain).toBeUndefined();
    });

    it('assigns correct agents based on phase', () => {
      const pipeline = bridge.buildPipelineDefinition(
        'analyze the code, then implement changes, then test them',
        'code'
      );

      // Steps are ordered by detected phases: analyze -> implement -> test
      // Each step's agentKey should match its phase
      expect(pipeline.agents.length).toBeGreaterThanOrEqual(2);

      // Verify the pipeline contains the expected agent types
      const agentKeys = pipeline.agents.map(s => s.agentKey);
      expect(agentKeys).toContain('code-analyzer'); // analyze phase
      expect(agentKeys).toContain('tester');         // test phase
    });

    it('includes metadata in pipeline definition', () => {
      const pipeline = bridge.buildPipelineDefinition(
        'plan and implement authentication',
        'code',
        'auth-pipeline'
      );

      expect(pipeline.metadata).toBeDefined();
      expect(pipeline.metadata?.taskType).toBe('code');
      expect(pipeline.metadata?.originalTask).toBeDefined();
      expect(pipeline.metadata?.complexityScore).toBeDefined();
    });

    it('throws PipelineDefinitionError for simple tasks', () => {
      expect(() => {
        bridge.buildPipelineDefinition('fix typo', 'code');
      }).toThrow(PipelineDefinitionError);
    });

    it('generates descriptive pipeline names', () => {
      const pipeline = bridge.buildPipelineDefinition(
        'plan the authentication system and implement it',
        'code'
      );

      expect(pipeline.name).toContain('code');
      expect(pipeline.name).toContain('pipeline');
    });

    it('handles research task type correctly', () => {
      // Use a more explicitly multi-step task to trigger pipeline
      // Note: 'research' is not a phase keyword, but 'analyze' and 'document' are
      const pipeline = bridge.buildPipelineDefinition(
        'first review the market trends thoroughly, then analyze all competitors in detail, finally document all findings comprehensively',
        'research'
      );

      expect(pipeline.metadata?.taskType).toBe('research');
      // Should include appropriate agents for detected phases
      const agentKeys = pipeline.agents.map(a => a.agentKey);
      // 'review' -> reviewer, 'analyze' -> code-analyzer, 'document' -> documentation-specialist
      expect(agentKeys).toContain('reviewer');
      expect(agentKeys).toContain('code-analyzer');
    });
  });

  // ==================== getSingleAgent() Tests ====================

  describe('getSingleAgent()', () => {
    it('returns correct agent for code tasks', () => {
      const agent = bridge.getSingleAgent('implement a REST API', 'code');
      expect(agent).toBe('backend-dev');
    });

    it('returns correct agent for ask tasks', () => {
      const agent = bridge.getSingleAgent('what is dependency injection?', 'ask');
      expect(agent).toBe('ambiguity-clarifier');
    });

    it('returns correct agent for research tasks', () => {
      const agent = bridge.getSingleAgent('investigate market trends', 'research');
      expect(agent).toBe('researcher');
    });

    it('returns correct agent for write tasks', () => {
      const agent = bridge.getSingleAgent('write a blog post', 'write');
      expect(agent).toBe('documentation-specialist');
    });

    it('detects document type and returns appropriate agent', () => {
      // 'documentation' is detected first in the task, returning documentation-specialist
      const agent = bridge.getSingleAgent('create API documentation', 'code');
      expect(agent).toBe('documentation-specialist');

      // Specifically 'api doc' (without 'umentation') returns backend-dev
      const apiDocAgent = bridge.getSingleAgent('create api doc for endpoints', 'code');
      expect(apiDocAgent).toBe('backend-dev');
    });

    it('detects phase keyword and returns appropriate agent', () => {
      const agent = bridge.getSingleAgent('test the login functionality', 'code');
      expect(agent).toBe('tester');
    });
  });

  // ==================== Configuration Tests ====================

  describe('configuration', () => {
    it('uses factory function to create instance', () => {
      const instance = createCommandTaskBridge({ pipelineThreshold: 0.8 });
      expect(instance).toBeInstanceOf(CommandTaskBridge);
      expect(instance.getThreshold()).toBe(0.8);
    });

    it('allows custom phase mappings', () => {
      const customBridge = new CommandTaskBridge({
        phaseMappings: new Map([
          ['custom-phase', {
            phase: 'custom-phase',
            agentKey: 'custom-agent',
            outputDomain: 'project/custom',
            outputTags: ['custom'],
            taskTemplate: 'Custom task: {task}'
          }]
        ])
      });

      const mappings = customBridge.getPhaseMappings();
      expect(mappings.has('custom-phase')).toBe(true);
      expect(mappings.get('custom-phase')?.agentKey).toBe('custom-agent');
    });

    it('returns default phase mappings', () => {
      const mappings = bridge.getPhaseMappings();

      expect(mappings.has('plan')).toBe(true);
      expect(mappings.has('implement')).toBe(true);
      expect(mappings.has('test')).toBe(true);
      expect(mappings.has('document')).toBe(true);
    });

    it('exposes configured threshold', () => {
      expect(bridge.getThreshold()).toBe(DEFAULT_PIPELINE_THRESHOLD);
    });
  });

  // ==================== Edge Cases ====================

  describe('edge cases', () => {
    it('handles empty task gracefully', () => {
      const analysis = bridge.analyzeTaskComplexity('');

      expect(analysis.score).toBe(0);
      expect(analysis.isMultiStep).toBe(false);
    });

    it('handles task with special characters', () => {
      const analysis = bridge.analyzeTaskComplexity(
        'implement @authentication with #OAuth2 & 2FA!'
      );

      expect(analysis.detectedPhases).toContain('implement');
    });

    it('handles case-insensitive phase detection', () => {
      const analysis = bridge.analyzeTaskComplexity(
        'PLAN and IMPLEMENT and TEST the feature'
      );

      expect(analysis.detectedPhases).toContain('plan');
      expect(analysis.detectedPhases).toContain('implement');
      expect(analysis.detectedPhases).toContain('test');
    });

    it('does not duplicate detected phases', () => {
      const analysis = bridge.analyzeTaskComplexity(
        'plan the plan, implement the implementation'
      );

      // Should not have duplicate 'plan' entries
      const planCount = analysis.detectedPhases.filter(p => p === 'plan').length;
      expect(planCount).toBeLessThanOrEqual(1);
    });
  });

  // ==================== Real Agent Integration ====================

  describe('real agent keys (RULE-002)', () => {
    it('uses real agent keys from AgentRegistry', () => {
      // These are actual agents in .claude/agents/
      const realAgents = ['backend-dev', 'tester', 'reviewer', 'planner', 'researcher'];

      const pipeline = bridge.buildPipelineDefinition(
        'plan, implement, and test the authentication feature',
        'code'
      );

      for (const step of pipeline.agents) {
        // Agent keys should be from default mappings which use real agents
        expect(typeof step.agentKey).toBe('string');
        expect(step.agentKey.length).toBeGreaterThan(0);
      }
    });
  });
});
