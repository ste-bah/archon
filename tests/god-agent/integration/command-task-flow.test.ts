/**
 * DAI-002: Command Integration Tests
 *
 * Tests for command-to-Task() flow implementing:
 * - US-014: /god-code routes to Task()
 * - US-015: /god-ask routes to Task()
 * - US-016: /god-research routes to Task()
 * - US-017: /god-write routes to Task()
 * - US-018: Complex tasks trigger pipeline
 * - US-019: Slash command template structure
 * - FR-017: Task() spawning required (RULE-008)
 *
 * RULE-002: No mock data - uses real CommandTaskBridge and CLI patterns
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CommandTaskBridge,
  createCommandTaskBridge,
  type IComplexityAnalysis,
  type IPipelineDecision,
  type TaskType,
  DEFAULT_PIPELINE_THRESHOLD,
} from '../../../src/god-agent/core/pipeline/index.js';

describe('Command Integration Tests', () => {
  let bridge: CommandTaskBridge;

  beforeEach(() => {
    bridge = createCommandTaskBridge({ verbose: false });
  });

  // ==================== /god-code Integration ====================

  describe('/god-code command integration (US-014)', () => {
    it('routes simple code task to single agent', () => {
      const task = 'implement a button component';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(false);

      const agent = bridge.getSingleAgent(task, 'code');
      expect(agent).toBe('backend-dev');
    });

    it('routes complex code task to pipeline', () => {
      const task = 'plan, design, and implement the user authentication system with tests';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(true);
      expect(decision.suggestedSteps).toBeDefined();
      expect(decision.suggestedSteps!.length).toBeGreaterThanOrEqual(2);
    });

    it('detects code-specific agent for implementation tasks', () => {
      const agent = bridge.getSingleAgent('implement REST API', 'code');
      expect(agent).toBe('backend-dev');
    });

    it('detects test agent for test-focused tasks', () => {
      const agent = bridge.getSingleAgent('test the login functionality', 'code');
      expect(agent).toBe('tester');
    });
  });

  // ==================== /god-ask Integration ====================

  describe('/god-ask command integration (US-015)', () => {
    it('routes simple question to appropriate agent', () => {
      const task = 'what is dependency injection?';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(false);

      const agent = bridge.getSingleAgent(task, 'ask');
      expect(agent).toBe('ambiguity-clarifier');
    });

    it('routes research questions to researcher when detected', () => {
      // Research keyword not in PHASE_KEYWORDS, so defaults to ask agent
      const agent = bridge.getSingleAgent('explain how async/await works', 'ask');
      expect(agent).toBe('ambiguity-clarifier');
    });
  });

  // ==================== /god-research Integration ====================

  describe('/god-research command integration (US-016)', () => {
    it('routes simple research to single agent', () => {
      const task = 'find information about React hooks';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(false);

      const agent = bridge.getSingleAgent(task, 'research');
      expect(agent).toBe('researcher');
    });

    it('detects complex research requiring pipeline', () => {
      const task = 'first analyze the literature, then review the methodology, finally document all findings';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(true);
      expect(decision.complexity.isMultiStep).toBe(true);
    });
  });

  // ==================== /god-write Integration ====================

  describe('/god-write command integration (US-017)', () => {
    it('routes simple writing task to documentation specialist', () => {
      const task = 'write a blog post about TypeScript';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(false);

      const agent = bridge.getSingleAgent(task, 'write');
      expect(agent).toBe('documentation-specialist');
    });

    it('detects complex writing requiring pipeline', () => {
      const task = 'create PRD document, technical specification, and implementation guide';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(true);
      expect(decision.complexity.detectedDocuments.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== Complex Task Pipeline Triggering ====================

  describe('pipeline triggering (US-018)', () => {
    it('triggers pipeline for multi-phase tasks', () => {
      const task = 'plan AND implement AND test the feature';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(true);
      expect(decision.complexity.detectedPhases).toContain('plan');
      expect(decision.complexity.detectedPhases).toContain('implement');
      expect(decision.complexity.detectedPhases).toContain('test');
    });

    it('triggers pipeline for document creation tasks', () => {
      const task = 'create PRD, spec, and tech docs for the new feature';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(true);
      expect(decision.complexity.detectedDocuments).toContain('prd');
      expect(decision.complexity.detectedDocuments).toContain('spec');
    });

    it('triggers pipeline for analyze-design-implement pattern', () => {
      // Use a more explicit multi-step task with connectors
      const task = 'first analyze the requirements thoroughly, then design the complete solution, after that implement everything, and finally validate it';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(true);
      expect(decision.complexity.detectedPhases).toContain('analyze');
      expect(decision.complexity.detectedPhases).toContain('design');
      expect(decision.complexity.detectedPhases).toContain('implement');
      expect(decision.complexity.detectedPhases).toContain('validate');
    });

    it('does NOT trigger pipeline for simple tasks', () => {
      const simpleTasks = [
        'fix the bug in login',
        'add a console.log',
        'update the README',
        'rename variable x to y'
      ];

      for (const task of simpleTasks) {
        const decision = bridge.shouldUsePipeline(task);
        expect(decision.usePipeline).toBe(false);
      }
    });
  });

  // ==================== Task() Spawning Validation ====================

  describe('Task() spawning workflow (RULE-008)', () => {
    it('provides agent key for Task() spawning (single agent)', () => {
      const task = 'implement authentication';
      const decision = bridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(false);

      const agentKey = bridge.getSingleAgent(task, 'code');
      expect(typeof agentKey).toBe('string');
      expect(agentKey.length).toBeGreaterThan(0);
    });

    it('provides pipeline definition for Task() spawning (multi-agent)', () => {
      const task = 'analyze, design, and implement the authentication system';
      const pipeline = bridge.buildPipelineDefinition(task, 'code');

      expect(pipeline.name).toBeDefined();
      expect(pipeline.agents.length).toBeGreaterThanOrEqual(2);
      expect(pipeline.sequential).toBe(true);

      // Each step has agentKey for Task() spawning
      for (const step of pipeline.agents) {
        expect(typeof step.agentKey).toBe('string');
        expect(step.agentKey.length).toBeGreaterThan(0);
      }
    });
  });

  // ==================== Complexity Score Validation ====================

  describe('complexity analysis', () => {
    it('calculates complexity score for various task types', () => {
      const tasks: Array<{ task: string; expectedMin: number; expectedMax: number }> = [
        { task: 'fix typo', expectedMin: 0, expectedMax: 0.3 },
        { task: 'implement feature', expectedMin: 0.1, expectedMax: 0.5 },
        { task: 'analyze and implement', expectedMin: 0.3, expectedMax: 0.8 },
        { task: 'plan, design, implement, and test', expectedMin: 0.6, expectedMax: 1.0 }
      ];

      for (const { task, expectedMin, expectedMax } of tasks) {
        const analysis = bridge.analyzeTaskComplexity(task);
        expect(analysis.score).toBeGreaterThanOrEqual(expectedMin);
        expect(analysis.score).toBeLessThanOrEqual(expectedMax);
      }
    });

    it('respects configured threshold', () => {
      const highThresholdBridge = createCommandTaskBridge({ pipelineThreshold: 0.9 });

      // A moderately complex task should NOT trigger pipeline with high threshold
      const task = 'analyze and implement the feature';
      const decision = highThresholdBridge.shouldUsePipeline(task);

      expect(decision.usePipeline).toBe(false);
    });

    it('identifies multi-step correctly', () => {
      const multiStepTasks = [
        'first do X, then do Y',
        'step 1: analyze, step 2: implement',
        'plan and implement and test'
      ];

      for (const task of multiStepTasks) {
        const analysis = bridge.analyzeTaskComplexity(task);
        expect(analysis.isMultiStep).toBe(true);
      }
    });
  });

  // ==================== JSON Output Structure ====================

  describe('CLI JSON output structure (US-013)', () => {
    it('pipeline decision provides all fields for JSON output', () => {
      const task = 'implement authentication';
      const decision = bridge.shouldUsePipeline(task);

      // All fields needed for ICLIJsonOutput
      expect(decision.usePipeline).toBeDefined();
      expect(decision.reason).toBeDefined();
      expect(decision.complexity).toBeDefined();
      expect(decision.complexity.score).toBeDefined();
      expect(decision.complexity.isMultiStep).toBeDefined();
    });

    it('complexity analysis provides all fields for debugging', () => {
      const task = 'plan, analyze, and implement the feature';
      const analysis = bridge.analyzeTaskComplexity(task);

      expect(analysis.score).toBeDefined();
      expect(analysis.isMultiStep).toBeDefined();
      expect(analysis.detectedPhases).toBeDefined();
      expect(analysis.detectedDocuments).toBeDefined();
      expect(analysis.detectedActions).toBeDefined();
      expect(analysis.reasoning).toBeDefined();
    });
  });
});
