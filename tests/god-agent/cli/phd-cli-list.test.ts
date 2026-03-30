/**
 * Tests for phd-cli list command
 * Validates REQ-PIPE-005
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { commandList } from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager } from '../../../src/god-agent/cli/session-manager.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('phd-cli list command', () => {
  const testSessionDir = '/tmp/test-phd-sessions-list';
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

  describe('commandList', () => {
    it('should list sessions [REQ-PIPE-005]', async () => {
      await createTestSession();
      await createTestSession();

      const response = await commandList({}, testSessionDir);

      expect(response.total).toBe(2);
      expect(response.sessions).toHaveLength(2);
    });

    it('should return empty list when no sessions', async () => {
      const response = await commandList({}, testSessionDir);

      expect(response.total).toBe(0);
      expect(response.sessions).toHaveLength(0);
    });

    it('should include session summary fields', async () => {
      const session = await createTestSession({
        status: 'running',
        completedAgents: ['agent-0', 'agent-1']
      });

      const response = await commandList({}, testSessionDir);

      const item = response.sessions.find(s => s.sessionId === session.sessionId);
      expect(item).toBeDefined();
      expect(item?.sessionId).toBe(session.sessionId);
      expect(item?.status).toBe('running');
      expect(item?.progress).toBeGreaterThanOrEqual(0);
    });

    it('should truncate query to 50 chars', async () => {
      const longQuery = 'A'.repeat(100);
      await createTestSession({ query: longQuery });

      const response = await commandList({}, testSessionDir);

      expect(response.sessions[0].query.length).toBeLessThanOrEqual(50);
      expect(response.sessions[0].query).toMatch(/\.\.\.$/);
    });

    it('should not truncate query if 50 chars or less', async () => {
      const shortQuery = 'A'.repeat(30);
      await createTestSession({ query: shortQuery });

      const response = await commandList({}, testSessionDir);

      expect(response.sessions[0].query).toBe(shortQuery);
    });

    it('should filter to sessions within 7 days by default', async () => {
      // Create recent session
      await createTestSession({
        lastActivityTime: Date.now()
      });

      // Create old session (8 days ago)
      const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000);
      await createTestSession({
        lastActivityTime: oldTime
      });

      const response = await commandList({}, testSessionDir);

      // Only recent session should be included
      expect(response.total).toBe(1);
    });

    it('should include all sessions with --all flag', async () => {
      // Create recent session
      await createTestSession({
        lastActivityTime: Date.now()
      });

      // Create old session (8 days ago)
      const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000);
      await createTestSession({
        lastActivityTime: oldTime
      });

      const response = await commandList({ all: true }, testSessionDir);

      // Both sessions should be included
      expect(response.total).toBe(2);
    });

    it('should sort by lastActivityTime descending', async () => {
      const now = Date.now();

      // Create sessions with different activity times
      const session1 = await createTestSession({
        lastActivityTime: now - 60000 // 1 minute ago
      });

      const session2 = await createTestSession({
        lastActivityTime: now - 30000 // 30 seconds ago (more recent)
      });

      const response = await commandList({}, testSessionDir);

      // Most recent should be first
      expect(response.sessions[0].sessionId).toBe(session2.sessionId);
      expect(response.sessions[1].sessionId).toBe(session1.sessionId);
    });

    it('should include startTime and lastActivityTime', async () => {
      const startTime = Date.now() - 60000;
      const lastActivityTime = Date.now();

      await createTestSession({
        startTime,
        lastActivityTime
      });

      const response = await commandList({}, testSessionDir);

      expect(response.sessions[0].startTime).toBe(startTime);
      expect(response.sessions[0].lastActivityTime).toBe(lastActivityTime);
    });

    it('should calculate progress as percentage', async () => {
      await createTestSession({
        completedAgents: Array.from({ length: 9 }, (_, i) => `agent-${i}`) // 9 of 46
      });

      const response = await commandList({}, testSessionDir);

      // 9/46 = ~19.6% (rounded by implementation)
      expect(response.sessions[0].progress).toBeCloseTo(19.6, 0);
    });

    it('should include pipeline ID', async () => {
      await createTestSession({
        pipelineId: 'test-pipeline-abc'
      });

      const response = await commandList({}, testSessionDir);

      expect(response.sessions[0].pipelineId).toBe('test-pipeline-abc');
    });
  });
});
