/**
 * Tests for phd-cli status command
 * Validates REQ-PIPE-004
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { commandStatus } from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager, SessionNotFoundError } from '../../../src/god-agent/cli/session-manager.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('phd-cli status command', () => {
  const testSessionDir = '/tmp/test-phd-sessions-status';
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

  describe('commandStatus', () => {
    it('should return session status with progress [REQ-PIPE-004]', async () => {
      const session = await createTestSession({
        completedAgents: ['step-back-analyzer', 'self-ask-decomposer']
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.sessionId).toBe(session.sessionId);
      expect(response.progress.completed).toBe(2);
      expect(response.progress.total).toBeGreaterThan(0);
      expect(response.progress.percentage).toBeGreaterThanOrEqual(0);
    });

    it('should show current phase and agent', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.currentPhase).toBe(1);
      expect(response.phaseName).toBe('Foundation');
      expect(response.currentAgent.key).toBe('step-back-analyzer');
    });

    it('should include session status', async () => {
      const session = await createTestSession({
        status: 'running'
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.status).toBe('running');
    });

    it('should include timing information', async () => {
      const startTime = Date.now() - 60000; // 1 minute ago
      const session = await createTestSession({
        startTime,
        lastActivityTime: Date.now() - 30000
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.startTime).toBe(startTime);
      expect(response.lastActivityTime).toBeDefined();
      expect(response.elapsedTime).toBeGreaterThan(0);
    });

    it('should truncate query to 200 chars if longer', async () => {
      const longQuery = 'A'.repeat(300);
      const session = await createTestSession({
        query: longQuery
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.query.length).toBeLessThanOrEqual(200);
      expect(response.query).toMatch(/\.\.\.$/);
    });

    it('should not truncate query if 200 chars or less', async () => {
      const shortQuery = 'A'.repeat(100);
      const session = await createTestSession({
        query: shortQuery
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.query).toBe(shortQuery);
    });

    it('should include errors array', async () => {
      const session = await createTestSession({
        errors: [
          { agentKey: 'test-agent', error: 'Test error', timestamp: Date.now() }
        ]
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].agentKey).toBe('test-agent');
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      const fakeSessionId = uuidv4();
      await expect(commandStatus(fakeSessionId, {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);
    });

    it('should handle completed pipeline', async () => {
      const session = await createTestSession({
        currentAgentIndex: 999, // Beyond all agents
        completedAgents: Array.from({ length: 46 }, (_, i) => `agent-${i}`)
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.currentAgent.key).toBe('complete');
      expect(response.progress.percentage).toBe(100);
    });

    it('should calculate percentage with one decimal place', async () => {
      const session = await createTestSession({
        completedAgents: ['agent-0', 'agent-1', 'agent-2']
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      // Percentage should be a valid number with at most one decimal
      const percentStr = response.progress.percentage.toString();
      const decimalParts = percentStr.split('.');
      if (decimalParts.length > 1) {
        expect(decimalParts[1].length).toBeLessThanOrEqual(1);
      }
    });

    it('should include pipeline ID', async () => {
      const session = await createTestSession({
        pipelineId: 'test-pipeline-123'
      });

      const response = await commandStatus(session.sessionId, {}, testSessionDir);

      expect(response.pipelineId).toBe('test-pipeline-123');
    });
  });
});
