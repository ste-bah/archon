/**
 * Integration tests for phd-cli end-to-end workflow
 * Validates complete pipeline execution flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  commandInit,
  commandNext,
  commandComplete,
  commandStatus,
  commandList,
  commandResume,
  commandAbort
} from '../../../src/god-agent/cli/phd-cli.js';
import { SessionManager, SessionExpiredError, SessionNotFoundError } from '../../../src/god-agent/cli/session-manager.js';
import { AgentMismatchError } from '../../../src/god-agent/cli/cli-types.js';

describe('PhD CLI Integration Tests', () => {
  const testSessionDir = '/tmp/test-phd-integration';
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

  describe('Complete workflow', () => {
    it('should execute init → next → complete → next flow', async () => {
      // Step 1: Initialize session
      const initResponse = await commandInit('Test research query', {}, testSessionDir);

      expect(initResponse.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(initResponse.totalAgents).toBe(46);
      expect(initResponse.agent.index).toBe(0);
      expect(initResponse.agent.key).toBe('step-back-analyzer');
      expect(initResponse.agent.phase).toBe(1);

      const sessionId = initResponse.sessionId;

      // Verify session was saved (can be loaded by sessionManager)
      const savedSession = await sessionManager.loadSession(sessionId);
      expect(savedSession.sessionId).toBe(sessionId);

      // Step 2: Get next agent (should be first agent since we haven't completed any)
      const nextResponse = await commandNext(sessionId, {}, testSessionDir);

      expect(nextResponse.status).toBe('next');
      expect(nextResponse.agent?.index).toBe(0);
      expect(nextResponse.agent?.key).toBe('step-back-analyzer');
      expect(nextResponse.progress.completed).toBe(0);

      // Step 3: Complete first agent with output
      const completeResponse = await commandComplete(
        sessionId,
        'step-back-analyzer',
        { result: JSON.stringify({ questions: ['Q1', 'Q2'] }) },
        testSessionDir
      );

      expect(completeResponse.success).toBe(true);
      expect(completeResponse.nextAgent).toBe('self-ask-decomposer');

      // Step 4: Get next agent
      const next2Response = await commandNext(sessionId, {}, testSessionDir);

      expect(next2Response.status).toBe('next');
      expect(next2Response.agent?.index).toBe(1);
      expect(next2Response.agent?.key).toBe('self-ask-decomposer');
      expect(next2Response.progress.completed).toBe(1);
      expect(next2Response.progress.percentage).toBe(2.2); // 1/46 ≈ 2.2%

      // Verify session state persisted
      const session = await sessionManager.loadSession(sessionId);

      expect(session.completedAgents).toContain('step-back-analyzer');
      expect(session.currentAgentIndex).toBe(1);
      expect(session.agentOutputs['step-back-analyzer']).toEqual({
        questions: ['Q1', 'Q2']
      });

      // Cleanup: abort session
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('should execute multiple agent completions in sequence', async () => {
      const initResponse = await commandInit('Multi-agent test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Complete first 3 agents
      const agents = ['step-back-analyzer', 'self-ask-decomposer', 'ambiguity-clarifier'];

      for (let i = 0; i < agents.length; i++) {
        const completeResponse = await commandComplete(sessionId, agents[i], { force: true }, testSessionDir);
        expect(completeResponse.success).toBe(true);

        if (i < agents.length - 1) {
          const nextResponse = await commandNext(sessionId, {}, testSessionDir);
          expect(nextResponse.agent?.key).toBe(agents[i + 1]);
        }
      }

      // Verify progress
      const statusResponse = await commandStatus(sessionId, {}, testSessionDir);
      expect(statusResponse.progress.completed).toBe(3);
      expect(statusResponse.currentAgent.key).toBe('research-planner');

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('should handle pipeline completion detection', async () => {
      const initResponse = await commandInit('Completion test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Manually fast-forward session to completion
      const session = await sessionManager.loadSession(sessionId);
      session.currentAgentIndex = 46;
      session.completedAgents = Array.from({ length: 46 }, (_, i) => `agent-${i}`);
      await sessionManager.saveSession(session);

      // Next should report complete
      const nextResponse = await commandNext(sessionId, {}, testSessionDir);

      expect(nextResponse.status).toBe('complete');
      expect(nextResponse.progress.percentage).toBe(100);
      expect(nextResponse.summary).toBeDefined();
      expect(nextResponse.summary?.agentsCompleted).toBe(46);

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });
  });

  describe('Style injection', () => {
    it('should inject style for Phase 6 agents', async () => {
      const initResponse = await commandInit('Style injection test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Fast-forward to Phase 6 (introduction-writer at index 30)
      const session = await sessionManager.loadSession(sessionId);
      session.currentAgentIndex = 30;
      session.completedAgents = Array.from({ length: 30 }, (_, i) => `agent-${i}`);
      await sessionManager.saveSession(session);

      // Get Phase 6 agent
      const nextResponse = await commandNext(sessionId, {}, testSessionDir);

      // Phase 6 starts at index 30 with introduction-writer
      expect(nextResponse.agent?.phase).toBe(6);
      expect(nextResponse.agent?.phaseName).toBe('Writing');

      // Verify style injection in prompt
      const prompt = nextResponse.agent?.prompt || '';
      expect(prompt.length).toBeGreaterThan(0);

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('should NOT inject style for Phase 1-5 agents', async () => {
      const initResponse = await commandInit('Non-Phase-6 test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // First agent is Phase 1
      const nextResponse = await commandNext(sessionId, {}, testSessionDir);

      expect(nextResponse.agent?.phase).toBe(1);
      // Prompt should not contain style injection markers
      const prompt = nextResponse.agent?.prompt || '';
      expect(prompt).not.toContain('Language Variant:');
      expect(prompt).not.toContain('Regional Spelling Rules:');

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });
  });

  describe('Session management', () => {
    it('should resume interrupted session correctly', async () => {
      const initResponse = await commandInit('Resume test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Complete some agents
      await commandComplete(sessionId, 'step-back-analyzer', { force: true }, testSessionDir);
      await commandComplete(sessionId, 'self-ask-decomposer', { force: true }, testSessionDir);

      // Simulate interruption (just stop calling commands)

      // Resume should return current agent (not next)
      const resumeResponse = await commandResume(sessionId, {}, testSessionDir);

      expect(resumeResponse.resumed).toBe(true);
      expect(resumeResponse.progress.completed).toBe(2);
      expect(resumeResponse.agent.index).toBe(2);
      expect(resumeResponse.agent.key).toBe('ambiguity-clarifier');

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('should manage multiple concurrent sessions', async () => {
      // Create multiple sessions
      const session1 = await commandInit('Query 1', {}, testSessionDir);
      const session2 = await commandInit('Query 2', {}, testSessionDir);
      const session3 = await commandInit('Query 3', {}, testSessionDir);

      // List sessions
      const listResponse = await commandList({}, testSessionDir);

      expect(listResponse.total).toBeGreaterThanOrEqual(3);

      const sessionIds = listResponse.sessions.map(s => s.sessionId);
      expect(sessionIds).toContain(session1.sessionId);
      expect(sessionIds).toContain(session2.sessionId);
      expect(sessionIds).toContain(session3.sessionId);

      // Work on different sessions independently
      await commandComplete(session1.sessionId, 'step-back-analyzer', { force: true }, testSessionDir);
      await commandComplete(session2.sessionId, 'step-back-analyzer', { force: true }, testSessionDir);

      // Verify each session has independent state
      const status1 = await commandStatus(session1.sessionId, {}, testSessionDir);
      const status2 = await commandStatus(session2.sessionId, {}, testSessionDir);
      const status3 = await commandStatus(session3.sessionId, {}, testSessionDir);

      expect(status1.progress.completed).toBe(1);
      expect(status2.progress.completed).toBe(1);
      expect(status3.progress.completed).toBe(0);

      // Cleanup all sessions
      await commandAbort(session1.sessionId, {}, testSessionDir);
      await commandAbort(session2.sessionId, {}, testSessionDir);
      await commandAbort(session3.sessionId, {}, testSessionDir);
    });

    it('should reject expired sessions', async () => {
      const initResponse = await commandInit('Expiry test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Manually set lastActivityTime to 25 hours ago
      const session = await sessionManager.loadSession(sessionId);
      session.lastActivityTime = Date.now() - (25 * 60 * 60 * 1000);
      await sessionManager.saveSession(session);

      // Resume should fail with SessionExpiredError
      await expect(commandResume(sessionId, {}, testSessionDir))
        .rejects.toThrow(SessionExpiredError);

      // Next should also fail
      await expect(commandNext(sessionId, {}, testSessionDir))
        .rejects.toThrow(SessionExpiredError);

      // Status should still work (informational)
      const statusResponse = await commandStatus(sessionId, {}, testSessionDir);
      expect(statusResponse.sessionId).toBe(sessionId);
    });

    it('should abort session and update status', async () => {
      const initResponse = await commandInit('Abort test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Complete some agents
      await commandComplete(sessionId, 'step-back-analyzer', { force: true }, testSessionDir);
      await commandComplete(sessionId, 'self-ask-decomposer', { force: true }, testSessionDir);

      // Abort session
      const abortResponse = await commandAbort(sessionId, {}, testSessionDir);

      expect(abortResponse.aborted).toBe(true);
      expect(abortResponse.finalStatus).toBe('failed');
      expect(abortResponse.completedAgents).toBe(2);

      // Verify session status updated
      const statusResponse = await commandStatus(sessionId, {}, testSessionDir);
      expect(statusResponse.status).toBe('failed');
    });
  });

  describe('Error handling', () => {
    it('should reject empty query', async () => {
      await expect(commandInit('', {}, testSessionDir))
        .rejects.toThrow(/cannot be empty/i);
    });

    it('should reject non-existent session', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';

      await expect(commandNext(fakeSessionId, {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);

      await expect(commandComplete(fakeSessionId, 'any-agent', {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);

      await expect(commandResume(fakeSessionId, {}, testSessionDir))
        .rejects.toThrow(SessionNotFoundError);
    });

    it('should reject wrong agent key on complete', async () => {
      const initResponse = await commandInit('Wrong agent test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      await expect(commandComplete(sessionId, 'wrong-agent-key', {}, testSessionDir))
        .rejects.toThrow(AgentMismatchError);

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('should reject completing out-of-order agent', async () => {
      const initResponse = await commandInit('Out of order test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      // Try to complete second agent without completing first
      await expect(commandComplete(sessionId, 'self-ask-decomposer', { force: true }, testSessionDir))
        .rejects.toThrow(AgentMismatchError);

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });
  });

  describe('Performance', () => {
    it('init command should respond quickly', async () => {
      const start = Date.now();

      const response = await commandInit('Performance test query', {}, testSessionDir);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000); // 2 seconds max

      // Cleanup
      await commandAbort(response.sessionId, {}, testSessionDir);
    });

    it('next command should respond quickly', async () => {
      const initResponse = await commandInit('Next perf test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      const start = Date.now();

      await commandNext(sessionId, {}, testSessionDir);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // 1 second max

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('complete command should respond quickly', async () => {
      const initResponse = await commandInit('Complete perf test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      const start = Date.now();

      await commandComplete(sessionId, 'step-back-analyzer', { force: true }, testSessionDir);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500); // 500ms max

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });
  });

  describe('Data integrity', () => {
    it('should persist agent outputs correctly', async () => {
      const initResponse = await commandInit('Output test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      const testOutput = {
        findings: ['Finding 1', 'Finding 2'],
        score: 0.95,
        nested: { key: 'value' }
      };

      await commandComplete(sessionId, 'step-back-analyzer', {
        result: JSON.stringify(testOutput)
      }, testSessionDir);

      // Verify output persisted
      const session = await sessionManager.loadSession(sessionId);

      expect(session.agentOutputs['step-back-analyzer']).toEqual(testOutput);

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });

    it('should update timestamps correctly', async () => {
      const initResponse = await commandInit('Timestamp test', {}, testSessionDir);
      const sessionId = initResponse.sessionId;

      const session1 = await sessionManager.loadSession(sessionId);
      const originalTime = session1.lastActivityTime;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Perform action
      await commandNext(sessionId, {}, testSessionDir);

      const session2 = await sessionManager.loadSession(sessionId);
      expect(session2.lastActivityTime).toBeGreaterThan(originalTime);

      // Cleanup
      await commandAbort(sessionId, {}, testSessionDir);
    });
  });
});
