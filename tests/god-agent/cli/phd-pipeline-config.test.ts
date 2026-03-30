/**
 * PhD Pipeline Configuration Tests - TASK-VALIDATE-001
 *
 * Comprehensive unit tests for the PhD Pipeline configuration and utility functions.
 * Tests phd-pipeline-config.ts with 46 agents across 7 phases.
 *
 * Constitution Compliance:
 * - RULE-008: Real tests only - no mock data that could leak to production
 * - RULE-007: Tests use verification commands pattern
 * - RULE-005: Actionable error messages in test failures
 *
 * @module tests/god-agent/cli/phd-pipeline-config.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

// Import from phd-pipeline-config.ts
import {
  PHD_AGENTS,
  PHD_PHASES,
  DEFAULT_CONFIG,
  getAgentByKey,
  getAgentsByPhase,
  getPhaseById,
  getPhaseName,
  getTotalAgentCount,
  getTotalPhaseCount,
  getAgentIndex,
  getAgentByIndex,
  validateConfiguration,
  createInitialSessionState,
  getAgentFilePath,
  isSessionState,
  isAgentConfig,
  type AgentConfig,
  type PhaseDefinition,
  type SessionState,
} from '../../../src/god-agent/cli/phd-pipeline-config.js';

// ============================================================================
// TEST SUITE 1: PHD_AGENTS CONFIGURATION
// ============================================================================

describe('PhD Pipeline Configuration', () => {
  describe('PHD_AGENTS', () => {
    it('should have exactly 46 agents', () => {
      // RULE-019: All 46 agents must be configured
      expect(PHD_AGENTS).toHaveLength(46);
    });

    it('should have getTotalAgentCount() return 46', () => {
      expect(getTotalAgentCount()).toBe(46);
    });

    it('should have all agents with required fields', () => {
      // Each agent must have: key, displayName, phase, file, memoryKeys, outputArtifacts
      for (const agent of PHD_AGENTS) {
        expect(agent).toHaveProperty('key');
        expect(agent).toHaveProperty('displayName');
        expect(agent).toHaveProperty('phase');
        expect(agent).toHaveProperty('file');
        expect(agent).toHaveProperty('memoryKeys');
        expect(agent).toHaveProperty('outputArtifacts');

        // Validate types
        expect(typeof agent.key).toBe('string');
        expect(typeof agent.displayName).toBe('string');
        expect(typeof agent.phase).toBe('number');
        expect(typeof agent.file).toBe('string');
        expect(Array.isArray(agent.memoryKeys)).toBe(true);
        expect(Array.isArray(agent.outputArtifacts)).toBe(true);
      }
    });

    it('should have unique agent keys', () => {
      const keys = PHD_AGENTS.map((agent) => agent.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should have all agents with valid phase numbers (1-7)', () => {
      for (const agent of PHD_AGENTS) {
        expect(agent.phase).toBeGreaterThanOrEqual(1);
        expect(agent.phase).toBeLessThanOrEqual(7);
      }
    });

    it('should have all agent keys in kebab-case format', () => {
      const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
      for (const agent of PHD_AGENTS) {
        expect(agent.key).toMatch(kebabCaseRegex);
      }
    });

    it('should have all agent files ending in .md', () => {
      for (const agent of PHD_AGENTS) {
        expect(agent.file).toMatch(/\.md$/);
      }
    });

    it('should have at least one memoryKey for each agent', () => {
      for (const agent of PHD_AGENTS) {
        expect(agent.memoryKeys.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have at least one outputArtifact for each agent', () => {
      for (const agent of PHD_AGENTS) {
        expect(agent.outputArtifacts.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have agents ordered by phase', () => {
      let lastPhase = 0;
      for (const agent of PHD_AGENTS) {
        expect(agent.phase).toBeGreaterThanOrEqual(lastPhase);
        lastPhase = agent.phase;
      }
    });
  });

  // ============================================================================
  // TEST SUITE 2: PHD_PHASES CONFIGURATION
  // ============================================================================

  describe('PHD_PHASES', () => {
    it('should have exactly 7 phases', () => {
      expect(PHD_PHASES).toHaveLength(7);
    });

    it('should have getTotalPhaseCount() return 7', () => {
      expect(getTotalPhaseCount()).toBe(7);
    });

    it('should have phases with sequential IDs from 1 to 7', () => {
      for (let i = 0; i < PHD_PHASES.length; i++) {
        expect(PHD_PHASES[i].id).toBe(i + 1);
      }
    });

    it('should have all phases with required fields', () => {
      for (const phase of PHD_PHASES) {
        expect(phase).toHaveProperty('id');
        expect(phase).toHaveProperty('name');
        expect(phase).toHaveProperty('agentKeys');
        expect(phase).toHaveProperty('description');

        // Validate types
        expect(typeof phase.id).toBe('number');
        expect(typeof phase.name).toBe('string');
        expect(Array.isArray(phase.agentKeys)).toBe(true);
        expect(typeof phase.description).toBe('string');
      }
    });

    it('should have unique phase names', () => {
      const names = PHD_PHASES.map((phase) => phase.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have expected phase names', () => {
      const expectedNames = [
        'Foundation',
        'Discovery',
        'Architecture',
        'Synthesis',
        'Design',
        'Writing',
        'Validation',
      ];
      const actualNames = PHD_PHASES.map((phase) => phase.name);
      expect(actualNames).toEqual(expectedNames);
    });

    it('should have expected agent counts per phase', () => {
      // Phase 1: 7 agents (Foundation)
      // Phase 2: 4 agents (Discovery)
      // Phase 3: 4 agents (Architecture)
      // Phase 4: 5 agents (Synthesis)
      // Phase 5: 9 agents (Design)
      // Phase 6: 6 agents (Writing)
      // Phase 7: 11 agents (Validation)
      const expectedCounts = [7, 4, 4, 5, 9, 6, 11];

      for (let i = 0; i < PHD_PHASES.length; i++) {
        expect(PHD_PHASES[i].agentKeys).toHaveLength(expectedCounts[i]);
      }
    });

    it('should have total of 46 agents across all phases', () => {
      const totalAgents = PHD_PHASES.reduce(
        (sum, phase) => sum + phase.agentKeys.length,
        0
      );
      expect(totalAgents).toBe(46);
    });

    it('should have all phase agentKeys reference valid agents', () => {
      const validAgentKeys = new Set(PHD_AGENTS.map((agent) => agent.key));

      for (const phase of PHD_PHASES) {
        for (const agentKey of phase.agentKeys) {
          expect(validAgentKeys.has(agentKey)).toBe(true);
        }
      }
    });

    it('should have non-empty descriptions for all phases', () => {
      for (const phase of PHD_PHASES) {
        expect(phase.description.length).toBeGreaterThan(10);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 3: getAgentByKey() FUNCTION
  // ============================================================================

  describe('getAgentByKey()', () => {
    it('should return correct agent for valid key', () => {
      const agent = getAgentByKey('self-ask-decomposer');
      expect(agent).toBeDefined();
      expect(agent?.key).toBe('self-ask-decomposer');
      expect(agent?.displayName).toBe('Self-Ask Decomposer');
      expect(agent?.phase).toBe(1);
    });

    it('should return undefined for non-existent key', () => {
      const agent = getAgentByKey('non-existent-agent');
      expect(agent).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const agent = getAgentByKey('');
      expect(agent).toBeUndefined();
    });

    it('should return correct agent for each Phase 1 agent', () => {
      const phase1Keys = [
        'step-back-analyzer',
        'self-ask-decomposer',
        'ambiguity-clarifier',
        'research-planner',
        'construct-definer',
        'dissertation-architect',
        'chapter-synthesizer',
      ];

      for (const key of phase1Keys) {
        const agent = getAgentByKey(key);
        expect(agent).toBeDefined();
        expect(agent?.phase).toBe(1);
      }
    });

    it('should return correct agent for last agent in pipeline', () => {
      const agent = getAgentByKey('file-length-manager');
      expect(agent).toBeDefined();
      expect(agent?.key).toBe('file-length-manager');
      expect(agent?.phase).toBe(7);
    });

    it('should be case-sensitive', () => {
      const agent = getAgentByKey('Self-Ask-Decomposer');
      expect(agent).toBeUndefined();
    });
  });

  // ============================================================================
  // TEST SUITE 4: getAgentsByPhase() FUNCTION
  // ============================================================================

  describe('getAgentsByPhase()', () => {
    it('should return 7 agents for Phase 1', () => {
      const agents = getAgentsByPhase(1);
      expect(agents).toHaveLength(7);
    });

    it('should return 4 agents for Phase 2', () => {
      const agents = getAgentsByPhase(2);
      expect(agents).toHaveLength(4);
    });

    it('should return 4 agents for Phase 3', () => {
      const agents = getAgentsByPhase(3);
      expect(agents).toHaveLength(4);
    });

    it('should return 5 agents for Phase 4', () => {
      const agents = getAgentsByPhase(4);
      expect(agents).toHaveLength(5);
    });

    it('should return 9 agents for Phase 5', () => {
      const agents = getAgentsByPhase(5);
      expect(agents).toHaveLength(9);
    });

    it('should return 6 agents for Phase 6', () => {
      const agents = getAgentsByPhase(6);
      expect(agents).toHaveLength(6);
    });

    it('should return 11 agents for Phase 7', () => {
      const agents = getAgentsByPhase(7);
      expect(agents).toHaveLength(11);
    });

    it('should return empty array for invalid phase 0', () => {
      const agents = getAgentsByPhase(0);
      expect(agents).toHaveLength(0);
    });

    it('should return empty array for invalid phase 8', () => {
      const agents = getAgentsByPhase(8);
      expect(agents).toHaveLength(0);
    });

    it('should return agents with correct phase number', () => {
      for (let phaseId = 1; phaseId <= 7; phaseId++) {
        const agents = getAgentsByPhase(phaseId);
        for (const agent of agents) {
          expect(agent.phase).toBe(phaseId);
        }
      }
    });

    it('should return all agents when aggregated across phases', () => {
      let totalAgents = 0;
      for (let phaseId = 1; phaseId <= 7; phaseId++) {
        totalAgents += getAgentsByPhase(phaseId).length;
      }
      expect(totalAgents).toBe(46);
    });
  });

  // ============================================================================
  // TEST SUITE 5: validateConfiguration() FUNCTION
  // ============================================================================

  describe('validateConfiguration()', () => {
    it('should return true for valid configuration', () => {
      expect(validateConfiguration()).toBe(true);
    });

    it('should not throw for valid configuration', () => {
      expect(() => validateConfiguration()).not.toThrow();
    });

    it('should validate that phase agent count matches total agents', () => {
      // This test verifies the internal consistency check
      const phaseAgentCount = PHD_PHASES.reduce(
        (sum, phase) => sum + phase.agentKeys.length,
        0
      );
      expect(phaseAgentCount).toBe(PHD_AGENTS.length);
    });

    it('should validate all phase agentKeys exist in PHD_AGENTS', () => {
      const agentKeys = new Set(PHD_AGENTS.map((agent) => agent.key));

      for (const phase of PHD_PHASES) {
        for (const key of phase.agentKeys) {
          expect(agentKeys.has(key)).toBe(true);
        }
      }
    });
  });

  // ============================================================================
  // TEST SUITE 6: getPhaseById() and getPhaseName() FUNCTIONS
  // ============================================================================

  describe('getPhaseById()', () => {
    it('should return correct phase for valid ID', () => {
      const phase = getPhaseById(1);
      expect(phase).toBeDefined();
      expect(phase?.id).toBe(1);
      expect(phase?.name).toBe('Foundation');
    });

    it('should return undefined for invalid phase ID 0', () => {
      const phase = getPhaseById(0);
      expect(phase).toBeUndefined();
    });

    it('should return undefined for invalid phase ID 8', () => {
      const phase = getPhaseById(8);
      expect(phase).toBeUndefined();
    });

    it('should return all phases correctly', () => {
      for (let id = 1; id <= 7; id++) {
        const phase = getPhaseById(id);
        expect(phase).toBeDefined();
        expect(phase?.id).toBe(id);
      }
    });
  });

  describe('getPhaseName()', () => {
    it('should return correct name for Phase 1', () => {
      expect(getPhaseName(1)).toBe('Foundation');
    });

    it('should return correct name for Phase 7', () => {
      expect(getPhaseName(7)).toBe('Validation');
    });

    it('should return "Unknown" for invalid phase', () => {
      expect(getPhaseName(0)).toBe('Unknown');
      expect(getPhaseName(8)).toBe('Unknown');
      expect(getPhaseName(-1)).toBe('Unknown');
    });

    it('should return correct names for all phases', () => {
      const expectedNames = [
        'Foundation',
        'Discovery',
        'Architecture',
        'Synthesis',
        'Design',
        'Writing',
        'Validation',
      ];

      for (let i = 0; i < expectedNames.length; i++) {
        expect(getPhaseName(i + 1)).toBe(expectedNames[i]);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 7: getAgentIndex() and getAgentByIndex() FUNCTIONS
  // ============================================================================

  describe('getAgentIndex()', () => {
    it('should return 0 for first agent', () => {
      expect(getAgentIndex('step-back-analyzer')).toBe(0);
    });

    it('should return 45 for last agent', () => {
      expect(getAgentIndex('file-length-manager')).toBe(45);
    });

    it('should return -1 for non-existent agent', () => {
      expect(getAgentIndex('non-existent-agent')).toBe(-1);
    });

    it('should return correct indices for all agents', () => {
      for (let i = 0; i < PHD_AGENTS.length; i++) {
        expect(getAgentIndex(PHD_AGENTS[i].key)).toBe(i);
      }
    });
  });

  describe('getAgentByIndex()', () => {
    it('should return first agent at index 0', () => {
      const agent = getAgentByIndex(0);
      expect(agent).toBeDefined();
      expect(agent?.key).toBe('step-back-analyzer');
    });

    it('should return last agent at index 45', () => {
      const agent = getAgentByIndex(45);
      expect(agent).toBeDefined();
      expect(agent?.key).toBe('file-length-manager');
    });

    it('should return undefined for negative index', () => {
      const agent = getAgentByIndex(-1);
      expect(agent).toBeUndefined();
    });

    it('should return undefined for index >= 46', () => {
      const agent = getAgentByIndex(46);
      expect(agent).toBeUndefined();
    });

    it('should return undefined for index 100', () => {
      const agent = getAgentByIndex(100);
      expect(agent).toBeUndefined();
    });

    it('should return correct agent for each index', () => {
      for (let i = 0; i < PHD_AGENTS.length; i++) {
        const agent = getAgentByIndex(i);
        expect(agent).toBeDefined();
        expect(agent?.key).toBe(PHD_AGENTS[i].key);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 8: createInitialSessionState() FUNCTION
  // ============================================================================

  describe('createInitialSessionState()', () => {
    it('should create session with correct sessionId', () => {
      const sessionId = 'test-session-123';
      const topic = 'Test research topic';
      const session = createInitialSessionState(sessionId, topic);

      expect(session.sessionId).toBe(sessionId);
    });

    it('should create session with correct topic', () => {
      const sessionId = 'test-session-123';
      const topic = 'Test research topic';
      const session = createInitialSessionState(sessionId, topic);

      expect(session.topic).toBe(topic);
    });

    it('should start at phase 1', () => {
      const session = createInitialSessionState('id', 'topic');
      expect(session.currentPhase).toBe(1);
    });

    it('should start at agent index 0', () => {
      const session = createInitialSessionState('id', 'topic');
      expect(session.currentAgentIndex).toBe(0);
    });

    it('should start with empty completedAgents array', () => {
      const session = createInitialSessionState('id', 'topic');
      expect(session.completedAgents).toEqual([]);
    });

    it('should have pending status', () => {
      const session = createInitialSessionState('id', 'topic');
      expect(session.status).toBe('pending');
    });

    it('should have valid ISO timestamps', () => {
      const session = createInitialSessionState('id', 'topic');

      // Should be valid ISO 8601 date strings
      expect(() => new Date(session.startedAt)).not.toThrow();
      expect(() => new Date(session.lastActivityAt)).not.toThrow();

      // Timestamps should be approximately now
      const now = Date.now();
      const startedAt = new Date(session.startedAt).getTime();
      expect(Math.abs(now - startedAt)).toBeLessThan(1000); // Within 1 second
    });

    it('should have startedAt equal to lastActivityAt initially', () => {
      const session = createInitialSessionState('id', 'topic');
      expect(session.startedAt).toBe(session.lastActivityAt);
    });
  });

  // ============================================================================
  // TEST SUITE 9: getAgentFilePath() FUNCTION
  // ============================================================================

  describe('getAgentFilePath()', () => {
    it('should return correct path for valid agent key', () => {
      const filePath = getAgentFilePath('self-ask-decomposer');
      expect(filePath).toBe('.claude/agents/phdresearch/self-ask-decomposer.md');
    });

    it('should return undefined for invalid agent key', () => {
      const filePath = getAgentFilePath('non-existent-agent');
      expect(filePath).toBeUndefined();
    });

    it('should use custom base directory when provided', () => {
      const filePath = getAgentFilePath('self-ask-decomposer', 'custom/path');
      expect(filePath).toBe('custom/path/self-ask-decomposer.md');
    });

    it('should return correct paths for all agents', () => {
      for (const agent of PHD_AGENTS) {
        const filePath = getAgentFilePath(agent.key);
        expect(filePath).toBe(`${DEFAULT_CONFIG.agentsDirectory}/${agent.file}`);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 10: TYPE GUARDS
  // ============================================================================

  describe('isSessionState()', () => {
    it('should return true for valid SessionState', () => {
      const validSession: SessionState = {
        sessionId: 'test-id',
        topic: 'test topic',
        currentPhase: 1,
        currentAgentIndex: 0,
        completedAgents: [],
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: 'pending',
      };
      expect(isSessionState(validSession)).toBe(true);
    });

    it('should return true for all valid status values', () => {
      const statuses = ['pending', 'running', 'paused', 'completed', 'failed', 'phase8'] as const;

      for (const status of statuses) {
        const session = {
          sessionId: 'test-id',
          topic: 'test topic',
          currentPhase: 1,
          currentAgentIndex: 0,
          completedAgents: [],
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          status,
        };
        expect(isSessionState(session)).toBe(true);
      }
    });

    it('should return false for null', () => {
      expect(isSessionState(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isSessionState(undefined)).toBe(false);
    });

    it('should return false for missing sessionId', () => {
      const invalid = {
        topic: 'test topic',
        currentPhase: 1,
        currentAgentIndex: 0,
        completedAgents: [],
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: 'pending',
      };
      expect(isSessionState(invalid)).toBe(false);
    });

    it('should return false for invalid status', () => {
      const invalid = {
        sessionId: 'test-id',
        topic: 'test topic',
        currentPhase: 1,
        currentAgentIndex: 0,
        completedAgents: [],
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: 'invalid-status',
      };
      expect(isSessionState(invalid)).toBe(false);
    });
  });

  describe('isAgentConfig()', () => {
    it('should return true for valid AgentConfig', () => {
      const validAgent = PHD_AGENTS[0];
      expect(isAgentConfig(validAgent)).toBe(true);
    });

    it('should return true for all PHD_AGENTS', () => {
      for (const agent of PHD_AGENTS) {
        expect(isAgentConfig(agent)).toBe(true);
      }
    });

    it('should return false for null', () => {
      expect(isAgentConfig(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isAgentConfig(undefined)).toBe(false);
    });

    it('should return false for missing key', () => {
      const invalid = {
        displayName: 'Test Agent',
        phase: 1,
        file: 'test.md',
        memoryKeys: [],
        outputArtifacts: [],
      };
      expect(isAgentConfig(invalid)).toBe(false);
    });

    it('should return false for missing phase', () => {
      const invalid = {
        key: 'test-agent',
        displayName: 'Test Agent',
        file: 'test.md',
        memoryKeys: [],
        outputArtifacts: [],
      };
      expect(isAgentConfig(invalid)).toBe(false);
    });
  });

  // ============================================================================
  // TEST SUITE 11: DEFAULT_CONFIG
  // ============================================================================

  describe('DEFAULT_CONFIG', () => {
    it('should have correct agents reference', () => {
      expect(DEFAULT_CONFIG.agents).toBe(PHD_AGENTS);
    });

    it('should have correct phases reference', () => {
      expect(DEFAULT_CONFIG.phases).toBe(PHD_PHASES);
    });

    it('should have correct memoryNamespace', () => {
      expect(DEFAULT_CONFIG.memoryNamespace).toBe('project/research');
    });

    it('should have correct agentsDirectory', () => {
      expect(DEFAULT_CONFIG.agentsDirectory).toBe('.claude/agents/phdresearch');
    });
  });

  // ============================================================================
  // TEST SUITE 12: PHASE-SPECIFIC AGENT VERIFICATION
  // ============================================================================

  describe('Phase-specific agent verification', () => {
    it('should have correct Phase 1 (Foundation) agents', () => {
      const phase1 = getPhaseById(1);
      const expectedKeys = [
        'step-back-analyzer',
        'self-ask-decomposer',
        'ambiguity-clarifier',
        'research-planner',
        'construct-definer',
        'dissertation-architect',
        'chapter-synthesizer',
      ];
      expect(phase1?.agentKeys).toEqual(expectedKeys);
    });

    it('should have correct Phase 2 (Discovery) agents', () => {
      const phase2 = getPhaseById(2);
      const expectedKeys = [
        'literature-mapper',
        'source-tier-classifier',
        'citation-extractor',
        'context-tier-manager',
      ];
      expect(phase2?.agentKeys).toEqual(expectedKeys);
    });

    it('should have correct Phase 3 (Architecture) agents', () => {
      const phase3 = getPhaseById(3);
      const expectedKeys = [
        'theoretical-framework-analyst',
        'contradiction-analyzer',
        'gap-hunter',
        'risk-analyst',
      ];
      expect(phase3?.agentKeys).toEqual(expectedKeys);
    });

    it('should have correct Phase 4 (Synthesis) agents', () => {
      const phase4 = getPhaseById(4);
      const expectedKeys = [
        'evidence-synthesizer',
        'pattern-analyst',
        'thematic-synthesizer',
        'theory-builder',
        'opportunity-identifier',
      ];
      expect(phase4?.agentKeys).toEqual(expectedKeys);
    });

    it('should have correct Phase 5 (Design) agents', () => {
      const phase5 = getPhaseById(5);
      const expectedKeys = [
        'method-designer',
        'hypothesis-generator',
        'model-architect',
        'analysis-planner',
        'sampling-strategist',
        'instrument-developer',
        'validity-guardian',
        'methodology-scanner',
        'methodology-writer',
      ];
      expect(phase5?.agentKeys).toEqual(expectedKeys);
    });

    it('should have correct Phase 6 (Writing) agents', () => {
      const phase6 = getPhaseById(6);
      const expectedKeys = [
        'introduction-writer',
        'literature-review-writer',
        'results-writer',
        'discussion-writer',
        'conclusion-writer',
        'abstract-writer',
      ];
      expect(phase6?.agentKeys).toEqual(expectedKeys);
    });

    it('should have correct Phase 7 (Validation) agents', () => {
      const phase7 = getPhaseById(7);
      const expectedKeys = [
        'systematic-reviewer',
        'ethics-reviewer',
        'adversarial-reviewer',
        'confidence-quantifier',
        'citation-validator',
        'reproducibility-checker',
        'apa-citation-specialist',
        'consistency-validator',
        'quality-assessor',
        'bias-detector',
        'file-length-manager',
      ];
      expect(phase7?.agentKeys).toEqual(expectedKeys);
    });
  });
});
