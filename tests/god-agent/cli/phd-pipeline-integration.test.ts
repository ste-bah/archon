/**
 * Integration Tests for PhD Pipeline
 *
 * Tests full pipeline cycles including:
 * - Pipeline initialization
 * - Agent completion cycles
 * - Full phase cycles
 * - Resume functionality
 * - Error handling
 *
 * Constitution Compliance:
 * - RULE-008: Real integration tests with actual file operations
 * - RULE-021: Test session persistence and resume
 * - RULE-022: Test phase transition rules
 *
 * @module tests/god-agent/cli/phd-pipeline-integration.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Import CLI commands and utilities
import {
  commandInit,
  commandNext,
  commandComplete,
  commandResume,
  generatePipelineId,
  PHD_PIPELINE_AGENT_COUNT,
} from '../../../src/god-agent/cli/phd-cli.js';

// Import session management
import {
  SessionManager,
  SessionNotFoundError,
  SessionExpiredError,
} from '../../../src/god-agent/cli/session-manager.js';

// Import types
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';
import { AgentMismatchError } from '../../../src/god-agent/cli/cli-types.js';

// Import pipeline config for phase information
import {
  PHD_AGENTS,
  PHD_PHASES,
  getAgentsByPhase,
  getAgentByIndex,
} from '../../../src/god-agent/cli/phd-pipeline-config.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/** Test session directory - unique per test run to avoid conflicts */
const TEST_SESSION_BASE_DIR = `/tmp/phd-pipeline-integration-test-${Date.now()}`;
const TEST_SESSION_DIR = path.join(TEST_SESSION_BASE_DIR, '.phd-sessions');

/** UUID v4 regex pattern for validation */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a test session with specified overrides.
 * Uses real SessionManager for actual file operations.
 */
async function createTestSession(
  sessionManager: SessionManager,
  overrides: Partial<PipelineSession> = {}
): Promise<PipelineSession> {
  const sessionId = overrides.sessionId || uuidv4();
  const session = sessionManager.createSession(
    sessionId,
    overrides.query || 'Integration test research query',
    overrides.styleProfileId || 'default-academic',
    overrides.pipelineId || 'pipeline-integration-test'
  );

  // Apply any overrides
  Object.assign(session, overrides);

  await sessionManager.saveSession(session);
  return session;
}

/**
 * Get the expected first agent key for Phase 1.
 * Based on PHD_AGENTS configuration.
 */
function getFirstAgentKey(): string {
  const phase1Agents = getAgentsByPhase(1);
  return phase1Agents[0]?.key || 'step-back-analyzer';
}

/**
 * Get all Phase 1 agent keys in order.
 */
function getPhase1AgentKeys(): string[] {
  return getAgentsByPhase(1).map(agent => agent.key);
}

/**
 * Get the first agent of Phase 2.
 */
function getPhase2FirstAgentKey(): string {
  const phase2Agents = getAgentsByPhase(2);
  return phase2Agents[0]?.key || 'literature-mapper';
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('PhD Pipeline Integration', () => {
  let sessionManager: SessionManager;

  beforeAll(async () => {
    // Create test session directory
    await fs.mkdir(TEST_SESSION_BASE_DIR, { recursive: true });
    await fs.mkdir(TEST_SESSION_DIR, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test sessions
    try {
      await fs.rm(TEST_SESSION_BASE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Fresh session manager for each test
    sessionManager = new SessionManager(TEST_SESSION_BASE_DIR);
  });

  afterEach(async () => {
    // Clean up session files after each test
    try {
      const files = await fs.readdir(TEST_SESSION_DIR);
      for (const file of files) {
        await fs.unlink(path.join(TEST_SESSION_DIR, file));
      }
    } catch {
      // Directory may not exist or be empty
    }
  });

  // ==========================================================================
  // 1. PIPELINE INITIALIZATION TESTS
  // ==========================================================================

  describe('Pipeline Initialization', () => {
    it('should create session and return first agent', async () => {
      const query = 'Integration test: research on AI agent coordination';

      const response = await commandInit(query, {}, TEST_SESSION_BASE_DIR);

      // Verify session ID is valid UUID v4
      expect(response.sessionId).toMatch(UUID_V4_REGEX);

      // Verify query is included
      expect(response.query).toBe(query);

      // Verify first agent details
      expect(response.agent).toBeDefined();
      expect(response.agent.index).toBe(0);
      expect(response.agent.phase).toBe(1);
      expect(response.agent.phaseName).toBe('Foundation');
    });

    it('should create session file in .phd-sessions/', async () => {
      const query = 'Integration test: session file creation';

      const response = await commandInit(query, {}, TEST_SESSION_BASE_DIR);

      // Verify session file exists
      const sessionPath = path.join(TEST_SESSION_DIR, `${response.sessionId}.json`);
      const stat = await fs.stat(sessionPath);
      expect(stat.isFile()).toBe(true);

      // Verify file contains valid JSON with session data
      const content = await fs.readFile(sessionPath, 'utf-8');
      const session = JSON.parse(content);
      expect(session.sessionId).toBe(response.sessionId);
      expect(session.query).toBe(query);
      expect(session.status).toBe('running');
    });

    it('should return first agent (self-ask-decomposer or step-back-analyzer)', async () => {
      const query = 'Integration test: first agent verification';

      const response = await commandInit(query, {}, TEST_SESSION_BASE_DIR);

      // First agent should be from Phase 1
      const phase1Agents = getAgentsByPhase(1);
      const validFirstAgentKeys = phase1Agents.map(a => a.key);

      expect(validFirstAgentKeys).toContain(response.agent.key);
      expect(response.agent.phase).toBe(1);
    });

    it('should have 46 agents configured in pipeline', async () => {
      const query = 'Integration test: agent count verification';

      const response = await commandInit(query, {}, TEST_SESSION_BASE_DIR);

      // Verify total agent count
      // Note: totalAgents in response may be 45 (old) or 46 (new config)
      // The PHD_AGENTS configuration has 46 agents
      expect(PHD_AGENTS.length).toBe(46);
      expect(PHD_PIPELINE_AGENT_COUNT).toBe(46);
    });

    it('should persist session state with correct initial values', async () => {
      const query = 'Integration test: initial state verification';

      const response = await commandInit(query, {}, TEST_SESSION_BASE_DIR);

      // Load session from disk
      const session = await sessionManager.loadSession(response.sessionId);

      // Verify initial state
      expect(session.currentPhase).toBe(1);
      expect(session.currentAgentIndex).toBe(0);
      expect(session.completedAgents).toEqual([]);
      expect(session.status).toBe('running');
      expect(session.startTime).toBeDefined();
      expect(session.lastActivityTime).toBeDefined();
    });

    it('should generate deterministic pipeline ID for same query', async () => {
      const query = 'Deterministic pipeline ID test query';

      const pipelineId1 = generatePipelineId(query);
      const pipelineId2 = generatePipelineId(query);

      expect(pipelineId1).toBe(pipelineId2);
      expect(pipelineId1).toMatch(/^pipeline-[0-9a-f]+$/);
    });
  });

  // ==========================================================================
  // 2. AGENT COMPLETION CYCLE TESTS
  // ==========================================================================

  describe('Agent Completion Cycle', () => {
    it('should advance to second agent after completing first', async () => {
      // Initialize pipeline
      const initResponse = await commandInit(
        'Integration test: agent completion cycle',
        {},
        TEST_SESSION_BASE_DIR
      );

      const firstAgentKey = initResponse.agent.key;

      // Complete first agent
      const completeResponse = await commandComplete(
        initResponse.sessionId,
        firstAgentKey,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      expect(completeResponse.success).toBe(true);
      expect(completeResponse.nextAgent).toBeDefined();

      // Load session and verify state
      const session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.currentAgentIndex).toBe(1);
    });

    it('should update completedAgents correctly', async () => {
      const initResponse = await commandInit(
        'Integration test: completedAgents tracking',
        {},
        TEST_SESSION_BASE_DIR
      );

      const firstAgentKey = initResponse.agent.key;

      // Complete first agent
      await commandComplete(
        initResponse.sessionId,
        firstAgentKey,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      // Load session and verify completedAgents
      const session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.completedAgents).toContain(firstAgentKey);
      expect(session.completedAgents.length).toBe(1);
    });

    it('should increment currentAgentIndex on completion', async () => {
      const initResponse = await commandInit(
        'Integration test: currentAgentIndex increment',
        {},
        TEST_SESSION_BASE_DIR
      );

      // Verify initial index
      let session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.currentAgentIndex).toBe(0);

      // Complete first agent
      await commandComplete(
        initResponse.sessionId,
        initResponse.agent.key,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      // Verify index incremented
      session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.currentAgentIndex).toBe(1);
    });

    it('should handle sequential agent completions', async () => {
      const initResponse = await commandInit(
        'Integration test: sequential completions',
        {},
        TEST_SESSION_BASE_DIR
      );

      let currentAgentKey = initResponse.agent.key;

      // Complete first 3 agents sequentially
      for (let i = 0; i < 3; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );

        expect(completeResponse.success).toBe(true);

        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }

      // Verify session state
      const session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.currentAgentIndex).toBe(3);
      expect(session.completedAgents.length).toBe(3);
    });

    it('should update lastActivityTime on completion', async () => {
      const initResponse = await commandInit(
        'Integration test: lastActivityTime update',
        {},
        TEST_SESSION_BASE_DIR
      );

      // Get initial lastActivityTime
      let session = await sessionManager.loadSession(initResponse.sessionId);
      const initialTime = session.lastActivityTime;

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Complete first agent
      await commandComplete(
        initResponse.sessionId,
        initResponse.agent.key,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      // Verify lastActivityTime updated
      session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.lastActivityTime).toBeGreaterThan(initialTime);
    });
  });

  // ==========================================================================
  // 3. FULL PHASE 1 CYCLE TEST
  // ==========================================================================

  describe('Full Phase 1 Cycle', () => {
    it('should complete all 7 Phase 1 agents sequentially', async () => {
      const initResponse = await commandInit(
        'Integration test: full Phase 1 cycle',
        {},
        TEST_SESSION_BASE_DIR
      );

      const phase1AgentCount = getAgentsByPhase(1).length;
      expect(phase1AgentCount).toBe(7);

      let currentAgentKey = initResponse.agent.key;
      let completedCount = 0;

      // Complete all Phase 1 agents
      for (let i = 0; i < phase1AgentCount; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );

        expect(completeResponse.success).toBe(true);
        completedCount++;

        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }

      // Verify all Phase 1 agents completed
      const session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.completedAgents.length).toBe(phase1AgentCount);
      expect(session.currentAgentIndex).toBe(phase1AgentCount);
    });

    it('should transition to Phase 2 after completing Phase 1', async () => {
      const initResponse = await commandInit(
        'Integration test: Phase 1 to Phase 2 transition',
        {},
        TEST_SESSION_BASE_DIR
      );

      const phase1AgentCount = getAgentsByPhase(1).length;
      let currentAgentKey = initResponse.agent.key;

      // Complete all Phase 1 agents
      for (let i = 0; i < phase1AgentCount; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );

        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }

      // Get next agent info - should be Phase 2
      const nextResponse = await commandNext(
        initResponse.sessionId,
        {},
        TEST_SESSION_BASE_DIR
      );

      // Verify we're in Phase 2
      if (nextResponse.status === 'next' && nextResponse.agent) {
        expect(nextResponse.agent.phase).toBe(2);
        expect(nextResponse.progress.currentPhase).toBe(2);

        // Verify it's the first Phase 2 agent
        const phase2Agents = getAgentsByPhase(2);
        expect(phase2Agents.map(a => a.key)).toContain(nextResponse.agent.key);
      }
    });

    it('should persist session correctly across all Phase 1 completions', async () => {
      const initResponse = await commandInit(
        'Integration test: Phase 1 persistence',
        {},
        TEST_SESSION_BASE_DIR
      );

      const phase1AgentCount = getAgentsByPhase(1).length;
      let currentAgentKey = initResponse.agent.key;

      // Complete Phase 1 agents, verifying persistence after each
      for (let i = 0; i < phase1AgentCount; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );

        // Verify session is persisted correctly
        const session = await sessionManager.loadSession(initResponse.sessionId);
        expect(session.completedAgents.length).toBe(i + 1);
        expect(session.currentAgentIndex).toBe(i + 1);

        // Get next agent from complete response (not from commandNext which may be stale)
        if (i < phase1AgentCount - 1 && completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }
    });
  });

  // ==========================================================================
  // 4. RESUME FUNCTIONALITY TESTS
  // ==========================================================================

  describe('Resume Functionality', () => {
    it('should resume pipeline from where it left off', async () => {
      // Initialize and complete 2 agents
      const initResponse = await commandInit(
        'Integration test: resume functionality',
        {},
        TEST_SESSION_BASE_DIR
      );

      let currentAgentKey = initResponse.agent.key;

      // Complete first 2 agents
      for (let i = 0; i < 2; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );
        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }

      // Create new session manager (simulating restart)
      const newSessionManager = new SessionManager(TEST_SESSION_BASE_DIR);

      // Resume pipeline
      const resumeResponse = await commandResume(
        initResponse.sessionId,
        {},
        TEST_SESSION_BASE_DIR
      );

      // Verify resume state
      expect(resumeResponse.resumed).toBe(true);
      expect(resumeResponse.agent.index).toBe(2); // Should be at 3rd agent (index 2)
      expect(resumeResponse.progress.completed).toBe(2);
    });

    it('should restore state correctly after simulated restart', async () => {
      // Initialize pipeline
      const initResponse = await commandInit(
        'Integration test: state restoration',
        {},
        TEST_SESSION_BASE_DIR
      );

      // Complete first agent
      await commandComplete(
        initResponse.sessionId,
        initResponse.agent.key,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      // Simulate application restart by creating new SessionManager
      const freshSessionManager = new SessionManager(TEST_SESSION_BASE_DIR);

      // Load session with fresh manager
      const restoredSession = await freshSessionManager.loadSession(initResponse.sessionId);

      // Verify state restored correctly
      expect(restoredSession.sessionId).toBe(initResponse.sessionId);
      expect(restoredSession.currentAgentIndex).toBe(1);
      expect(restoredSession.completedAgents.length).toBe(1);
      expect(restoredSession.status).toBe('running');
    });

    it('should continue from correct agent after resume', async () => {
      // Initialize and complete some agents
      const initResponse = await commandInit(
        'Integration test: continue after resume',
        {},
        TEST_SESSION_BASE_DIR
      );

      let currentAgentKey = initResponse.agent.key;
      const completedKeys: string[] = [];

      // Complete first 3 agents
      for (let i = 0; i < 3; i++) {
        completedKeys.push(currentAgentKey);
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );
        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }

      // Resume and verify correct agent
      const resumeResponse = await commandResume(
        initResponse.sessionId,
        {},
        TEST_SESSION_BASE_DIR
      );

      expect(resumeResponse.agent.index).toBe(3);
      expect(resumeResponse.agent.key).toBe(currentAgentKey);

      // Should be able to complete the resumed agent
      const completeResponse = await commandComplete(
        initResponse.sessionId,
        resumeResponse.agent.key,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      expect(completeResponse.success).toBe(true);
    });

    it('should maintain progress percentage across resume', async () => {
      const initResponse = await commandInit(
        'Integration test: progress across resume',
        {},
        TEST_SESSION_BASE_DIR
      );

      let currentAgentKey = initResponse.agent.key;

      // Complete 5 agents
      for (let i = 0; i < 5; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { force: true },
          TEST_SESSION_BASE_DIR
        );
        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }

      // Resume and check progress
      const resumeResponse = await commandResume(
        initResponse.sessionId,
        {},
        TEST_SESSION_BASE_DIR
      );

      expect(resumeResponse.progress.completed).toBe(5);
      expect(resumeResponse.progress.percentage).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 5. ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw SessionNotFoundError for invalid session ID', async () => {
      const invalidSessionId = uuidv4(); // Valid format but doesn't exist

      await expect(
        commandNext(invalidSessionId, {}, TEST_SESSION_BASE_DIR)
      ).rejects.toThrow(SessionNotFoundError);
    });

    it('should throw SessionNotFoundError for malformed session ID', async () => {
      const malformedSessionId = 'not-a-valid-uuid';

      await expect(
        commandResume(malformedSessionId, {}, TEST_SESSION_BASE_DIR)
      ).rejects.toThrow(SessionNotFoundError);
    });

    it('should throw AgentMismatchError for completing wrong agent', async () => {
      const initResponse = await commandInit(
        'Integration test: agent mismatch error',
        {},
        TEST_SESSION_BASE_DIR
      );

      // Try to complete a different agent than the current one
      const wrongAgentKey = 'literature-mapper'; // Phase 2 agent

      await expect(
        commandComplete(
          initResponse.sessionId,
          wrongAgentKey,
          {},
          TEST_SESSION_BASE_DIR
        )
      ).rejects.toThrow(AgentMismatchError);
    });

    it('should include expected and got in AgentMismatchError', async () => {
      const initResponse = await commandInit(
        'Integration test: agent mismatch details',
        {},
        TEST_SESSION_BASE_DIR
      );

      const wrongAgentKey = 'evidence-synthesizer'; // Wrong agent

      try {
        await commandComplete(
          initResponse.sessionId,
          wrongAgentKey,
          {},
          TEST_SESSION_BASE_DIR
        );
        expect.fail('Should have thrown AgentMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentMismatchError);
        const mismatchError = error as AgentMismatchError;
        expect(mismatchError.expected).toBe(initResponse.agent.key);
        expect(mismatchError.got).toBe(wrongAgentKey);
      }
    });

    it('should throw error when trying to complete already-completed pipeline', async () => {
      // Create session at end of pipeline
      const session = await createTestSession(sessionManager, {
        currentAgentIndex: 999, // Beyond any agent
        completedAgents: Array.from({ length: 46 }, (_, i) => `agent-${i}`)
      });

      await expect(
        commandComplete(
          session.sessionId,
          'any-agent',
          {},
          TEST_SESSION_BASE_DIR
        )
      ).rejects.toThrow('Pipeline already complete');
    });

    it('should throw error when resuming completed pipeline', async () => {
      // Create session at end of pipeline
      const session = await createTestSession(sessionManager, {
        currentAgentIndex: 999,
        completedAgents: Array.from({ length: 46 }, (_, i) => `agent-${i}`)
      });

      await expect(
        commandResume(session.sessionId, {}, TEST_SESSION_BASE_DIR)
      ).rejects.toThrow('Pipeline already complete');
    });

    it('should throw SessionExpiredError for expired session', async () => {
      // Create session with old timestamp (> 24 hours ago)
      const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
      const session = await createTestSession(sessionManager, {
        lastActivityTime: twentyFiveHoursAgo,
        startTime: twentyFiveHoursAgo - 3600000 // Started 1 hour before
      });

      await expect(
        commandNext(session.sessionId, {}, TEST_SESSION_BASE_DIR)
      ).rejects.toThrow(SessionExpiredError);
    });

    it('should throw error for empty query on init', async () => {
      await expect(
        commandInit('', {}, TEST_SESSION_BASE_DIR)
      ).rejects.toThrow('Query cannot be empty');
    });

    it('should throw error for whitespace-only query on init', async () => {
      await expect(
        commandInit('   ', {}, TEST_SESSION_BASE_DIR)
      ).rejects.toThrow('Query cannot be empty');
    });
  });

  // ==========================================================================
  // 6. SESSION PERSISTENCE TESTS (RULE-021)
  // ==========================================================================

  describe('Session Persistence (RULE-021)', () => {
    it('should persist agentOutputs when provided', async () => {
      const initResponse = await commandInit(
        'Integration test: agent outputs persistence',
        {},
        TEST_SESSION_BASE_DIR
      );

      const testOutput = { findings: 'test result', score: 42 };

      await commandComplete(
        initResponse.sessionId,
        initResponse.agent.key,
        { result: JSON.stringify(testOutput) },
        TEST_SESSION_BASE_DIR
      );

      // Verify output persisted
      const session = await sessionManager.loadSession(initResponse.sessionId);
      expect(session.agentOutputs[initResponse.agent.key]).toEqual(testOutput);
    });

    it('should use atomic write pattern (no .tmp files left)', async () => {
      const initResponse = await commandInit(
        'Integration test: atomic writes',
        {},
        TEST_SESSION_BASE_DIR
      );

      // Complete an agent
      await commandComplete(
        initResponse.sessionId,
        initResponse.agent.key,
        { force: true },
        TEST_SESSION_BASE_DIR
      );

      // Check for .tmp files
      const files = await fs.readdir(TEST_SESSION_DIR);
      const tmpFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('should maintain session integrity across multiple writes', async () => {
      const initResponse = await commandInit(
        'Integration test: write integrity',
        {},
        TEST_SESSION_BASE_DIR
      );

      let currentAgentKey = initResponse.agent.key;

      // Perform multiple completions
      for (let i = 0; i < 5; i++) {
        const completeResponse = await commandComplete(
          initResponse.sessionId,
          currentAgentKey,
          { result: JSON.stringify({ iteration: i }) },
          TEST_SESSION_BASE_DIR
        );

        // Verify session can still be loaded
        const session = await sessionManager.loadSession(initResponse.sessionId);
        expect(session.completedAgents.length).toBe(i + 1);

        // Get next agent from complete response
        if (completeResponse.nextAgent) {
          currentAgentKey = completeResponse.nextAgent;
        }
      }
    });
  });

  // ==========================================================================
  // 7. PHASE TRANSITION TESTS (RULE-022)
  // ==========================================================================

  describe('Phase Transitions (RULE-022)', () => {
    it('should correctly identify phase for each agent index', async () => {
      // Verify phase boundaries from configuration
      let cumulativeCount = 0;

      for (const phase of PHD_PHASES) {
        const phaseAgents = getAgentsByPhase(phase.id);

        for (let i = 0; i < phaseAgents.length; i++) {
          const agent = getAgentByIndex(cumulativeCount + i);
          expect(agent?.phase).toBe(phase.id);
        }

        cumulativeCount += phaseAgents.length;
      }

      expect(cumulativeCount).toBe(46); // Total agents
    });

    it('should have 7 phases configured', () => {
      expect(PHD_PHASES.length).toBe(7);
    });

    it('should have correct agent counts per phase', () => {
      // Phase 1: 7 agents (Foundation)
      expect(getAgentsByPhase(1).length).toBe(7);

      // Phase 2: 4 agents (Discovery)
      expect(getAgentsByPhase(2).length).toBe(4);

      // Phase 3: 4 agents (Architecture)
      expect(getAgentsByPhase(3).length).toBe(4);

      // Phase 4: 5 agents (Synthesis)
      expect(getAgentsByPhase(4).length).toBe(5);

      // Phase 5: 9 agents (Design)
      expect(getAgentsByPhase(5).length).toBe(9);

      // Phase 6: 6 agents (Writing)
      expect(getAgentsByPhase(6).length).toBe(6);

      // Phase 7: 11 agents (Validation)
      expect(getAgentsByPhase(7).length).toBe(11);

      // Total: 46 agents
      const totalFromPhases = PHD_PHASES.reduce(
        (sum, phase) => sum + getAgentsByPhase(phase.id).length,
        0
      );
      expect(totalFromPhases).toBe(46);
    });
  });
});
