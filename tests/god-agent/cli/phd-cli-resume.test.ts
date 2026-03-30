/**
 * Tests for phd-cli resume command
 * Validates REQ-PIPE-006
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { commandResume } from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager, SessionExpiredError, SessionNotFoundError } from '../../../src/god-agent/cli/session-manager.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('phd-cli resume command', () => {
  const testSessionDir = '/tmp/test-phd-sessions-resume';
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

  async function createTestSession(overrides: Partial<PipelineSession> = {}): Promise<PipelineSession> {
    const sessionId = overrides.sessionId || uuidv4();
    const session = sessionManager.createSession(
      sessionId,
      overrides.query || 'Test research query',
      overrides.styleProfileId || 'default-academic',
      overrides.pipelineId || 'pipeline-test'
    );
    Object.assign(session, overrides);
    await sessionManager.saveSession(session);
    return session;
  }

  describe('commandResume', () => {
    it('should return current agent (not next) [REQ-PIPE-006]', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      const response = await commandResume(session.sessionId, {}, testSessionDir);

      expect(response.resumed).toBe(true);
      expect(response.agent.key).toBe('step-back-analyzer');
      expect(response.agent.index).toBe(0);
    });

    it('should return agent from where left off', async () => {
      const session = await createTestSession({
        currentAgentIndex: 5, // 6th agent (0-indexed)
        completedAgents: ['agent-0', 'agent-1', 'agent-2', 'agent-3', 'agent-4']
      });

      const response = await commandResume(session.sessionId, {}, testSessionDir);

      expect(response.agent.index).toBe(5);
    });

    it('should include progress information', async () => {
      const session = await createTestSession({
        completedAgents: ['step-back-analyzer', 'self-ask-decomposer']
      });

      const response = await commandResume(session.sessionId, {}, testSessionDir);

      expect(response.progress.completed).toBe(2);
      expect(response.progress.total).toBeGreaterThan(0);
      expect(response.progress.percentage).toBeGreaterThanOrEqual(0);
    });

    it('should throw SessionExpiredError for expired sessions [REQ-PIPE-006]', async () => {
      const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const session = await createTestSession({
        lastActivityTime: oldTime
      });

      await expect(commandResume(session.sessionId, {}, testSessionDir))
        .rejects.toThrow(SessionExpiredError);
    });

    it('should update session lastActivityTime', async () => {
      const oldTime = Date.now() - 60000; // 1 minute ago
      const session = await createTestSession({
        lastActivityTime: oldTime
      });

      await commandResume(session.sessionId, {}, testSessionDir);

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.lastActivityTime).toBeGreaterThan(oldTime);
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      const fakeSessionId = uuidv4();
      await expect(commandResume(fakeSessionId, {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);
    });

    it('should throw error for completed pipeline', async () => {
      const session = await createTestSession({
        currentAgentIndex: 999, // Beyond all agents
        completedAgents: Array.from({ length: 45 }, (_, i) => `agent-${i}`)
      });

      await expect(commandResume(session.sessionId, {}, testSessionDir))
        .rejects.toThrow('Pipeline already complete');
    });

    it('should return agent with full details', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      const response = await commandResume(session.sessionId, {}, testSessionDir);

      expect(response.agent.key).toBeDefined();
      expect(response.agent.name).toBeDefined();
      expect(response.agent.phase).toBeGreaterThanOrEqual(1);
      expect(response.agent.phaseName).toBeDefined();
      expect(response.agent.prompt).toBeDefined();
      expect(Array.isArray(response.agent.dependencies)).toBe(true);
    });

    it('should include session ID in response', async () => {
      const session = await createTestSession();

      const response = await commandResume(session.sessionId, {}, testSessionDir);

      expect(response.sessionId).toBe(session.sessionId);
    });

    it('should handle mid-pipeline resume', async () => {
      const session = await createTestSession({
        currentAgentIndex: 10,
        completedAgents: Array.from({ length: 10 }, (_, i) => `agent-${i}`)
      });

      const response = await commandResume(session.sessionId, {}, testSessionDir);

      expect(response.resumed).toBe(true);
      expect(response.agent.index).toBe(10);
      expect(response.progress.completed).toBe(10);
    });
  });
});
