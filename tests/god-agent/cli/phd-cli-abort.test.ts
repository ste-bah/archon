/**
 * Tests for phd-cli abort command
 * Validates REQ-PIPE-007
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { commandAbort } from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager, SessionNotFoundError } from '../../../src/god-agent/cli/session-manager.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('phd-cli abort command', () => {
  const testSessionDir = '/tmp/test-phd-sessions-abort';
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

  describe('commandAbort', () => {
    it('should abort session and return aborted: true [REQ-PIPE-007]', async () => {
      const session = await createTestSession();

      const response = await commandAbort(session.sessionId, {}, testSessionDir);

      expect(response.aborted).toBe(true);
      expect(response.sessionId).toBe(session.sessionId);
    });

    it('should set session status to failed', async () => {
      const session = await createTestSession({
        status: 'running'
      });

      await commandAbort(session.sessionId, {}, testSessionDir);

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.status).toBe('failed');
    });

    it('should return final status as failed', async () => {
      const session = await createTestSession();

      const response = await commandAbort(session.sessionId, {}, testSessionDir);

      expect(response.finalStatus).toBe('failed');
    });

    it('should return completed agents count', async () => {
      const session = await createTestSession({
        completedAgents: ['agent-0', 'agent-1', 'agent-2']
      });

      const response = await commandAbort(session.sessionId, {}, testSessionDir);

      expect(response.completedAgents).toBe(3);
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      const fakeSessionId = uuidv4();
      await expect(commandAbort(fakeSessionId, {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);
    });

    it('should handle abort of fresh session (no completed agents)', async () => {
      const session = await createTestSession({
        completedAgents: []
      });

      const response = await commandAbort(session.sessionId, {}, testSessionDir);

      expect(response.aborted).toBe(true);
      expect(response.completedAgents).toBe(0);
    });

    it('should persist status change to disk', async () => {
      const session = await createTestSession({
        status: 'running'
      });

      await commandAbort(session.sessionId, {}, testSessionDir);

      // Reload from disk
      const reloaded = await sessionManager.loadSession(session.sessionId);
      expect(reloaded.status).toBe('failed');
    });

    it('should work with force option', async () => {
      const session = await createTestSession();

      const response = await commandAbort(session.sessionId, { force: true }, testSessionDir);

      expect(response.aborted).toBe(true);
    });

    it('should abort session mid-pipeline', async () => {
      const session = await createTestSession({
        currentAgentIndex: 20,
        completedAgents: Array.from({ length: 20 }, (_, i) => `agent-${i}`)
      });

      const response = await commandAbort(session.sessionId, {}, testSessionDir);

      expect(response.aborted).toBe(true);
      expect(response.completedAgents).toBe(20);
    });

    it('should update lastActivityTime when aborting', async () => {
      const oldTime = Date.now() - 60000;
      const session = await createTestSession({
        lastActivityTime: oldTime
      });

      await commandAbort(session.sessionId, {}, testSessionDir);

      const updated = await sessionManager.loadSession(session.sessionId);
      expect(updated.lastActivityTime).toBeGreaterThan(oldTime);
    });
  });
});
