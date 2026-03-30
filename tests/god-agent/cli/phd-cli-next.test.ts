/**
 * Tests for phd-cli next command
 * Validates REQ-PIPE-002
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { commandNext } from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager, SessionExpiredError, SessionNotFoundError } from '../../../src/god-agent/cli/session-manager.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('phd-cli next command', () => {
  const testSessionDir = '/tmp/test-phd-sessions-next';
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
    // Use valid UUID v4 format
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

  describe('commandNext', () => {
    it('should return next agent details for valid session [REQ-PIPE-002]', async () => {
      const session = await createTestSession();

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.status).toBe('next');
      expect(response.progress).toBeDefined();
      expect(response.agent).toBeDefined();
      expect(response.agent?.index).toBe(0);
      expect(response.agent?.key).toBeDefined();
      expect(response.agent?.prompt).toBeDefined();
    });

    it('should include progress with completed/total/percentage', async () => {
      const session = await createTestSession({
        completedAgents: ['step-back-analyzer', 'self-ask-decomposer']
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.progress.completed).toBe(2);
      expect(response.progress.total).toBeGreaterThan(0);
      expect(response.progress.percentage).toBeGreaterThanOrEqual(0);
      expect(response.progress.percentage).toBeLessThanOrEqual(100);
    });

    it('should include current phase number and name', async () => {
      const session = await createTestSession();

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.progress.currentPhase).toBeGreaterThanOrEqual(1);
      expect(response.progress.currentPhase).toBeLessThanOrEqual(7);
      expect(response.progress.phaseName).toBeDefined();
      expect(response.progress.phaseName.length).toBeGreaterThan(0);
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      // Use a valid UUID format for non-existent session
      const fakeSessionId = uuidv4();
      await expect(commandNext(fakeSessionId, {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);
    });

    it('should throw SessionExpiredError for expired session', async () => {
      // Create session with old timestamp (more than 24 hours ago)
      const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const session = await createTestSession({
        lastActivityTime: oldTime
      });

      await expect(commandNext(session.sessionId, {}, testSessionDir))
        .rejects.toThrow(SessionExpiredError);
    });

    it('should return status "complete" when all agents done', async () => {
      // Create session at end of pipeline
      const session = await createTestSession({
        currentAgentIndex: 999, // Beyond any agent count
        completedAgents: Array.from({ length: 45 }, (_, i) => `agent-${i}`)
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.status).toBe('complete');
      expect(response.progress.percentage).toBe(100);
      expect(response.summary).toBeDefined();
    });

    it('should include completion summary with duration and counts', async () => {
      const startTime = Date.now() - 60000; // 1 minute ago
      const session = await createTestSession({
        currentAgentIndex: 999,
        startTime,
        completedAgents: Array.from({ length: 45 }, (_, i) => `agent-${i}`),
        errors: [{ agentKey: 'test', message: 'error', timestamp: Date.now() }]
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.summary).toBeDefined();
      expect(response.summary?.duration).toBeGreaterThanOrEqual(60000);
      expect(response.summary?.agentsCompleted).toBe(45);
      expect(response.summary?.errors).toBe(1);
    });

    it('should update session lastActivityTime', async () => {
      const oldTime = Date.now() - 60000;
      const session = await createTestSession({
        lastActivityTime: oldTime
      });

      await commandNext(session.sessionId, {}, testSessionDir);

      // Reload session and check time was updated
      const updatedSession = await sessionManager.loadSession(session.sessionId);
      expect(updatedSession.lastActivityTime).toBeGreaterThan(oldTime);
    });

    it('should calculate progress percentage correctly', async () => {
      // Create session with some agents completed
      const session = await createTestSession({
        completedAgents: ['agent-0', 'agent-1', 'agent-2', 'agent-3', 'agent-4']
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      // 5 completed out of total should give correct percentage
      const expected = Math.round((5 / response.progress.total) * 1000) / 10;
      expect(response.progress.percentage).toBe(expected);
    });

    it('should return agent with expected properties', async () => {
      const session = await createTestSession();

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      const agent = response.agent;
      expect(agent).toBeDefined();
      expect(agent?.index).toBeDefined();
      expect(agent?.key).toBeDefined();
      expect(agent?.name).toBeDefined();
      expect(agent?.phase).toBeGreaterThanOrEqual(1);
      expect(agent?.phase).toBeLessThanOrEqual(7);
      expect(agent?.phaseName).toBeDefined();
      expect(agent?.prompt).toBeDefined();
      expect(Array.isArray(agent?.dependencies)).toBe(true);
      expect(typeof agent?.timeout).toBe('number');
      expect(typeof agent?.critical).toBe('boolean');
      expect(Array.isArray(agent?.expectedOutputs)).toBe(true);
    });

    it('should handle verbose option without errors', async () => {
      const session = await createTestSession();

      // Should not throw
      const response = await commandNext(session.sessionId, { verbose: true }, testSessionDir);

      expect(response.status).toBe('next');
    });
  });

  describe('progress calculation', () => {
    it('should report 0% when no agents completed', async () => {
      const session = await createTestSession({
        completedAgents: []
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.progress.completed).toBe(0);
      expect(response.progress.percentage).toBe(0);
    });

    it('should handle one decimal place precision', async () => {
      const session = await createTestSession({
        completedAgents: ['agent-0', 'agent-1', 'agent-2']
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      // Percentage should have at most one decimal place
      const percentageStr = response.progress.percentage.toString();
      const decimalParts = percentageStr.split('.');
      if (decimalParts.length > 1) {
        expect(decimalParts[1].length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('phase progression', () => {
    it('should return phase 1 for first agent', async () => {
      const session = await createTestSession({
        currentAgentIndex: 0
      });

      const response = await commandNext(session.sessionId, {}, testSessionDir);

      expect(response.progress.currentPhase).toBe(1);
      expect(response.progress.phaseName).toBe('Foundation');
    });
  });

  describe('error handling', () => {
    it('should handle corrupted session files', async () => {
      // Write corrupted JSON
      const sessionPath = path.join(testSessionDir, 'corrupted-session.json');
      await fs.writeFile(sessionPath, 'not valid json{');

      await expect(commandNext('corrupted-session', {}))
        .rejects.toThrow();
    });
  });
});
