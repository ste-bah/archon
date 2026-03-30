/**
 * Tests for phd-cli complete command
 * Validates REQ-PIPE-003, REQ-PIPE-024
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { commandComplete } from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager, SessionExpiredError, SessionNotFoundError } from '../../../src/god-agent/cli/session-manager.js';
import { AgentMismatchError } from '../../../src/god-agent/cli/cli-types.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('phd-cli complete command', () => {
  const testSessionDir = '/tmp/test-phd-sessions-complete';
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = new SessionManager(testSessionDir);
    await fs.mkdir(testSessionDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper to create a test session
  async function createTestSession(overrides: Partial<PipelineSession> = {}): Promise<PipelineSession> {
    const sessionId = overrides.sessionId || uuidv4();
    const session = sessionManager.createSession(
      sessionId,
      overrides.query || 'Test research query',
      overrides.styleProfileId || 'default-academic',
      overrides.pipelineId || 'pipeline-test'
    );

    // Apply overrides
    Object.assign(session, overrides);

    await sessionManager.saveSession(session);
    return session;
  }

  describe('commandComplete', () => {
    it('should return success: true for correct agent key [REQ-PIPE-003]', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      // First agent in pipeline is 'step-back-analyzer'
      const response = await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { force: true },
        testSessionDir
      );

      expect(response.success).toBe(true);
    });

    it('should increment currentAgentIndex by 1', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { force: true },
        testSessionDir
      );

      // Reload session
      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.currentAgentIndex).toBe(1);
    });

    it('should add agent key to completedAgents array', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        completedAgents: []
      });

      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { force: true },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.completedAgents).toContain('step-back-analyzer');
    });

    it('should update session lastActivityTime', async () => {
      const oldTime = Date.now() - 60000; // 1 minute ago
      const session = await createTestSession({
        currentAgentIndex: 0,
        lastActivityTime: oldTime
      });

      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { force: true },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.lastActivityTime).toBeGreaterThan(oldTime);
    });

    it('should throw AgentMismatchError for wrong agent key [REQ-PIPE-003]', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      await expect(commandComplete(
        session.sessionId,
        'wrong-agent-key',
        {},
        testSessionDir
      )).rejects.toThrow(AgentMismatchError);
    });

    it('should include expected and got in AgentMismatchError', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      try {
        await commandComplete(
          session.sessionId,
          'wrong-agent-key',
          {},
          testSessionDir
        );
        expect.fail('Should have thrown AgentMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentMismatchError);
        const mismatchError = error as AgentMismatchError;
        expect(mismatchError.expected).toBe('step-back-analyzer');
        expect(mismatchError.got).toBe('wrong-agent-key');
      }
    });

    it('should store parsed JSON in agentOutputs with --result [REQ-PIPE-024]', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        agentOutputs: {}
      });

      const testOutput = { findings: 'test result', score: 42 };
      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { result: JSON.stringify(testOutput) },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.agentOutputs['step-back-analyzer']).toEqual(testOutput);
    });

    it('should complete agent but warn on invalid JSON in --result', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        completedAgents: []
      });

      // Invalid JSON should still complete agent (with force flag since output is null)
      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { result: 'not valid json{', force: true },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.completedAgents).toContain('step-back-analyzer');
      expect(updated.agentOutputs['step-back-analyzer']).toBeUndefined();
    });

    it('should read and store file content with --file', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        agentOutputs: {}
      });

      // Create temp file with JSON content
      const testOutput = { fromFile: true, data: [1, 2, 3] };
      const filePath = path.join(testSessionDir, 'output.json');
      await fs.writeFile(filePath, JSON.stringify(testOutput), 'utf-8');

      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { file: filePath },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.agentOutputs['step-back-analyzer']).toEqual(testOutput);
    });

    it('should complete agent but warn on invalid JSON in file', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        completedAgents: []
      });

      // Create temp file with invalid JSON
      const filePath = path.join(testSessionDir, 'bad-output.json');
      await fs.writeFile(filePath, 'not valid json{', 'utf-8');

      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { file: filePath, force: true },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.completedAgents).toContain('step-back-analyzer');
      expect(updated.agentOutputs['step-back-analyzer']).toBeUndefined();
    });

    it('should complete agent and warn on missing file', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        completedAgents: []
      });

      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { file: '/nonexistent/file.json', force: true },
        testSessionDir
      );

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.completedAgents).toContain('step-back-analyzer');
    });

    it('should return nextAgent key if pipeline not complete', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      const response = await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { force: true },
        testSessionDir
      );

      expect(response.nextAgent).toBeDefined();
      // Next agent after step-back-analyzer is self-ask-decomposer
      expect(response.nextAgent).toBe('self-ask-decomposer');
    });

    it('should omit nextAgent if all agents complete', async () => {
      // Create session at the last agent (file-length-manager at index 45)
      const session = await createTestSession({
        currentAgentIndex: 45, // Last agent (0-indexed, 46 total)
        completedAgents: Array.from({ length: 45 }, (_, i) => `agent-${i}`)
      });

      const response = await commandComplete(
        session.sessionId,
        'file-length-manager', // Last agent in pipeline (order 46, index 45)
        { force: true },
        testSessionDir
      );

      expect(response.success).toBe(true);
      expect(response.nextAgent).toBeUndefined();
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      const fakeSessionId = uuidv4();
      await expect(commandComplete(
        fakeSessionId,
        'step-back-analyzer',
        {},
        testSessionDir
      )).rejects.toThrow(SessionNotFoundError);
    });

    it('should throw SessionExpiredError for expired session', async () => {
      const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const session = await createTestSession({
        lastActivityTime: oldTime
      });

      await expect(commandComplete(
        session.sessionId,
        'step-back-analyzer',
        {},
        testSessionDir
      )).rejects.toThrow(SessionExpiredError);
    });

    it('should throw error if pipeline already complete', async () => {
      // Create session with index beyond all agents
      const session = await createTestSession({
        currentAgentIndex: 999,
        completedAgents: Array.from({ length: 45 }, (_, i) => `agent-${i}`)
      });

      await expect(commandComplete(
        session.sessionId,
        'any-agent',
        {},
        testSessionDir
      )).rejects.toThrow('Pipeline already complete');
    });
  });

  describe('session persistence', () => {
    it('should persist all changes to session file', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        completedAgents: [],
        agentOutputs: {}
      });

      const testOutput = { key: 'value' };
      await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { result: JSON.stringify(testOutput) },
        testSessionDir
      );

      // Read file directly and parse
      const sessionPath = path.join(testSessionDir, '.phd-sessions', `${session.sessionId}.json`);
      const content = await fs.readFile(sessionPath, 'utf-8');
      const persisted = JSON.parse(content) as PipelineSession;

      expect(persisted.currentAgentIndex).toBe(1);
      expect(persisted.completedAgents).toContain('step-back-analyzer');
      expect(persisted.agentOutputs['step-back-analyzer']).toEqual(testOutput);
    });
  });

  describe('multiple completions', () => {
    it('should handle sequential agent completions', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0,
        completedAgents: []
      });

      // Complete first agent
      const response1 = await commandComplete(
        session.sessionId,
        'step-back-analyzer',
        { force: true },
        testSessionDir
      );
      expect(response1.nextAgent).toBe('self-ask-decomposer');

      // Complete second agent
      const response2 = await commandComplete(
        session.sessionId,
        'self-ask-decomposer',
        { force: true },
        testSessionDir
      );
      // After self-ask-decomposer (index 1), next is ambiguity-clarifier (index 2)
      expect(response2.nextAgent).toBe('ambiguity-clarifier');

      // Verify session state
      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.currentAgentIndex).toBe(2);
      expect(updated.completedAgents).toEqual([
        'step-back-analyzer',
        'self-ask-decomposer'
      ]);
    });
  });
});
