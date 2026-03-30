/**
 * Tests for SessionManager
 * Validates REQ-PIPE-020, REQ-PIPE-021, REQ-PIPE-022, REQ-PIPE-023
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  SessionManager,
  SessionNotFoundError,
  SessionCorruptedError
} from '../../../src/god-agent/cli/session-manager.js';
import type { PipelineSession } from '../../../src/god-agent/cli/cli-types.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let testBaseDir: string;
  let testSessionDir: string;

  beforeEach(async () => {
    // Create unique test directory
    testBaseDir = path.join(process.cwd(), `.test-session-manager-${Date.now()}`);
    testSessionDir = path.join(testBaseDir, '.phd-sessions');
    await fs.mkdir(testBaseDir, { recursive: true });
    sessionManager = new SessionManager(testBaseDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createSession', () => {
    it('should create session with valid UUID', () => {
      const sessionId = uuidv4();
      const query = 'test research query';
      const styleProfileId = 'academic-profile-123';
      const pipelineId = 'pipeline-abc';

      const session = sessionManager.createSession(
        sessionId,
        query,
        styleProfileId,
        pipelineId
      );

      expect(session.sessionId).toBe(sessionId);
      expect(session.query).toBe(query);
      expect(session.styleProfileId).toBe(styleProfileId);
      expect(session.pipelineId).toBe(pipelineId);
      expect(session.status).toBe('running');
      expect(session.currentPhase).toBe(1);
      expect(session.currentAgentIndex).toBe(0);
      expect(session.completedAgents).toEqual([]);
      expect(session.agentOutputs).toEqual({});
      expect(session.errors).toEqual([]);
    });

    it('should set timestamps on creation', () => {
      const sessionId = uuidv4();
      const before = Date.now();

      const session = sessionManager.createSession(
        sessionId,
        'query',
        'profile',
        'pipeline'
      );

      const after = Date.now();

      expect(session.startTime).toBeGreaterThanOrEqual(before);
      expect(session.startTime).toBeLessThanOrEqual(after);
      expect(session.lastActivityTime).toBeGreaterThanOrEqual(before);
      expect(session.lastActivityTime).toBeLessThanOrEqual(after);
    });

    it('should throw error for invalid UUID', () => {
      expect(() => {
        sessionManager.createSession('invalid-uuid', 'query', 'profile', 'pipeline');
      }).toThrow('Invalid session ID format');
    });

    it('should throw error for empty string UUID', () => {
      expect(() => {
        sessionManager.createSession('', 'query', 'profile', 'pipeline');
      }).toThrow('Invalid session ID format');
    });
  });

  describe('saveSession', () => {
    it('should create session file in .phd-sessions directory', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile-id',
        'pipeline-id'
      );

      await sessionManager.saveSession(session);

      const files = await fs.readdir(testSessionDir);
      expect(files).toContain(`${sessionId}.json`);
    });

    it('should save valid JSON', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile-id',
        'pipeline-id'
      );

      await sessionManager.saveSession(session);

      const content = await fs.readFile(
        path.join(testSessionDir, `${sessionId}.json`),
        'utf-8'
      );

      expect(() => JSON.parse(content)).not.toThrow();

      const saved = JSON.parse(content);
      expect(saved.sessionId).toBe(sessionId);
      expect(saved.query).toBe('test query');
    });

    it('should use atomic write pattern (no .tmp file left)', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile-id',
        'pipeline-id'
      );

      await sessionManager.saveSession(session);

      const files = await fs.readdir(testSessionDir);
      const tmpFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('should overwrite existing session file', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'original query',
        'profile-id',
        'pipeline-id'
      );

      await sessionManager.saveSession(session);

      // Modify and save again
      session.query = 'updated query';
      session.currentPhase = 3;

      await sessionManager.saveSession(session);

      const loaded = await sessionManager.loadSession(sessionId);
      expect(loaded.query).toBe('updated query');
      expect(loaded.currentPhase).toBe(3);
    });
  });

  describe('loadSession', () => {
    it('should load saved session correctly', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile-id',
        'pipeline-id'
      );

      await sessionManager.saveSession(session);

      const loaded = await sessionManager.loadSession(sessionId);

      expect(loaded.sessionId).toBe(sessionId);
      expect(loaded.query).toBe('test query');
      expect(loaded.styleProfileId).toBe('profile-id');
      expect(loaded.pipelineId).toBe('pipeline-id');
      expect(loaded.status).toBe('running');
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      const sessionId = uuidv4();

      await expect(sessionManager.loadSession(sessionId))
        .rejects
        .toThrow(SessionNotFoundError);
    });

    it('should throw SessionNotFoundError for invalid UUID', async () => {
      await expect(sessionManager.loadSession('invalid-uuid'))
        .rejects
        .toThrow(SessionNotFoundError);
    });

    it('should throw SessionCorruptedError for invalid JSON', async () => {
      const sessionId = uuidv4();

      // Create directory and write invalid JSON
      await fs.mkdir(testSessionDir, { recursive: true });
      await fs.writeFile(
        path.join(testSessionDir, `${sessionId}.json`),
        'not valid json { broken'
      );

      await expect(sessionManager.loadSession(sessionId))
        .rejects
        .toThrow(SessionCorruptedError);
    });
  });

  describe('sessionExists', () => {
    it('should return true for existing session', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile-id',
        'pipeline-id'
      );

      await sessionManager.saveSession(session);

      expect(await sessionManager.sessionExists(sessionId)).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      const sessionId = uuidv4();

      expect(await sessionManager.sessionExists(sessionId)).toBe(false);
    });

    it('should return false for invalid UUID', async () => {
      expect(await sessionManager.sessionExists('invalid-uuid')).toBe(false);
    });
  });

  describe('isSessionExpired', () => {
    it('should return false for recently active session', () => {
      const session: PipelineSession = {
        sessionId: uuidv4(),
        pipelineId: 'pipeline-id',
        query: 'test',
        styleProfileId: 'profile',
        status: 'running',
        currentPhase: 1,
        currentAgentIndex: 0,
        completedAgents: [],
        agentOutputs: {},
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        errors: []
      };

      expect(sessionManager.isSessionExpired(session)).toBe(false);
    });

    it('should return true for session inactive > 24 hours', () => {
      const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);

      const session: PipelineSession = {
        sessionId: uuidv4(),
        pipelineId: 'pipeline-id',
        query: 'test',
        styleProfileId: 'profile',
        status: 'running',
        currentPhase: 1,
        currentAgentIndex: 0,
        completedAgents: [],
        agentOutputs: {},
        startTime: twentyFiveHoursAgo,
        lastActivityTime: twentyFiveHoursAgo,
        errors: []
      };

      expect(sessionManager.isSessionExpired(session)).toBe(true);
    });

    it('should return false for session at exactly 24 hours', () => {
      const exactlyTwentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

      const session: PipelineSession = {
        sessionId: uuidv4(),
        pipelineId: 'pipeline-id',
        query: 'test',
        styleProfileId: 'profile',
        status: 'running',
        currentPhase: 1,
        currentAgentIndex: 0,
        completedAgents: [],
        agentOutputs: {},
        startTime: exactlyTwentyFourHoursAgo,
        lastActivityTime: exactlyTwentyFourHoursAgo,
        errors: []
      };

      // At exactly 24 hours, should still be valid
      expect(sessionManager.isSessionExpired(session)).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const sessions = await sessionManager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should return all recent sessions', async () => {
      // Create multiple sessions
      for (let i = 0; i < 3; i++) {
        const session = sessionManager.createSession(
          uuidv4(),
          `query ${i}`,
          'profile',
          'pipeline'
        );
        await sessionManager.saveSession(session);
      }

      const sessions = await sessionManager.listSessions();
      expect(sessions).toHaveLength(3);
    });

    it('should sort sessions by lastActivityTime descending', async () => {
      const sessions: PipelineSession[] = [];

      // Create sessions with different activity times
      for (let i = 0; i < 3; i++) {
        const session = sessionManager.createSession(
          uuidv4(),
          `query ${i}`,
          'profile',
          'pipeline'
        );
        // Stagger the activity times
        session.lastActivityTime = Date.now() - (i * 1000);
        sessions.push(session);
        await sessionManager.saveSession(session);
      }

      const listed = await sessionManager.listSessions();

      // Most recent should be first
      expect(listed[0].lastActivityTime).toBeGreaterThan(listed[1].lastActivityTime);
      expect(listed[1].lastActivityTime).toBeGreaterThan(listed[2].lastActivityTime);
    });

    it('should exclude sessions older than maxAgeDays', async () => {
      // Create recent session
      const recentSession = sessionManager.createSession(
        uuidv4(),
        'recent query',
        'profile',
        'pipeline'
      );
      await sessionManager.saveSession(recentSession);

      // Create old session (8 days ago)
      const oldSession = sessionManager.createSession(
        uuidv4(),
        'old query',
        'profile',
        'pipeline'
      );
      oldSession.lastActivityTime = Date.now() - (8 * 24 * 60 * 60 * 1000);
      await sessionManager.saveSession(oldSession);

      const sessions = await sessionManager.listSessions({ maxAgeDays: 7 });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].query).toBe('recent query');
    });

    it('should include all sessions when includeAll is true', async () => {
      // Create sessions of different ages
      const recentSession = sessionManager.createSession(
        uuidv4(),
        'recent',
        'profile',
        'pipeline'
      );
      await sessionManager.saveSession(recentSession);

      const oldSession = sessionManager.createSession(
        uuidv4(),
        'old',
        'profile',
        'pipeline'
      );
      oldSession.lastActivityTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
      await sessionManager.saveSession(oldSession);

      const sessions = await sessionManager.listSessions({ includeAll: true });
      expect(sessions).toHaveLength(2);
    });

    it('should skip corrupted session files', async () => {
      // Create valid session
      const validSession = sessionManager.createSession(
        uuidv4(),
        'valid query',
        'profile',
        'pipeline'
      );
      await sessionManager.saveSession(validSession);

      // Create corrupted session file
      await fs.writeFile(
        path.join(testSessionDir, `${uuidv4()}.json`),
        'invalid json'
      );

      const sessions = await sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].query).toBe('valid query');
    });

    it('should ignore .tmp files', async () => {
      const session = sessionManager.createSession(
        uuidv4(),
        'valid query',
        'profile',
        'pipeline'
      );
      await sessionManager.saveSession(session);

      // Create a stray .tmp file
      await fs.writeFile(
        path.join(testSessionDir, `${uuidv4()}.json.tmp`),
        '{}'
      );

      const sessions = await sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivityTime', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile',
        'pipeline'
      );

      const originalTime = session.lastActivityTime;

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await sessionManager.updateActivity(session);

      expect(session.lastActivityTime).toBeGreaterThan(originalTime);

      // Verify persisted
      const loaded = await sessionManager.loadSession(sessionId);
      expect(loaded.lastActivityTime).toBeGreaterThan(originalTime);
    });
  });

  describe('updateStatus', () => {
    it('should update session status', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile',
        'pipeline'
      );

      await sessionManager.saveSession(session);

      await sessionManager.updateStatus(session, 'paused');

      const loaded = await sessionManager.loadSession(sessionId);
      expect(loaded.status).toBe('paused');
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile',
        'pipeline'
      );

      await sessionManager.saveSession(session);
      expect(await sessionManager.sessionExists(sessionId)).toBe(true);

      await sessionManager.deleteSession(sessionId);
      expect(await sessionManager.sessionExists(sessionId)).toBe(false);
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      const sessionId = uuidv4();

      await expect(sessionManager.deleteSession(sessionId))
        .rejects
        .toThrow(SessionNotFoundError);
    });
  });

  describe('getMostRecentSession', () => {
    it('should return null when no sessions exist', async () => {
      const session = await sessionManager.getMostRecentSession();
      expect(session).toBeNull();
    });

    it('should return most recent session', async () => {
      // Create sessions with different times
      const older = sessionManager.createSession(
        uuidv4(),
        'older query',
        'profile',
        'pipeline'
      );
      older.lastActivityTime = Date.now() - 10000;
      await sessionManager.saveSession(older);

      const newer = sessionManager.createSession(
        uuidv4(),
        'newer query',
        'profile',
        'pipeline'
      );
      await sessionManager.saveSession(newer);

      const recent = await sessionManager.getMostRecentSession();
      expect(recent?.query).toBe('newer query');
    });
  });

  describe('session state fields (REQ-PIPE-021)', () => {
    it('should include all required session fields', async () => {
      const sessionId = uuidv4();
      const session = sessionManager.createSession(
        sessionId,
        'test query',
        'profile-id',
        'pipeline-id'
      );

      // Verify all REQ-PIPE-021 required fields
      expect(session).toHaveProperty('sessionId');
      expect(session).toHaveProperty('pipelineId');
      expect(session).toHaveProperty('query');
      expect(session).toHaveProperty('styleProfileId');
      expect(session).toHaveProperty('status');
      expect(session).toHaveProperty('currentPhase');
      expect(session).toHaveProperty('currentAgentIndex');
      expect(session).toHaveProperty('completedAgents');
      expect(session).toHaveProperty('agentOutputs');
      expect(session).toHaveProperty('startTime');
      expect(session).toHaveProperty('lastActivityTime');
      expect(session).toHaveProperty('errors');

      // Verify persistence includes all fields
      await sessionManager.saveSession(session);
      const loaded = await sessionManager.loadSession(sessionId);

      expect(loaded.sessionId).toBe(session.sessionId);
      expect(loaded.pipelineId).toBe(session.pipelineId);
      expect(loaded.query).toBe(session.query);
      expect(loaded.styleProfileId).toBe(session.styleProfileId);
      expect(loaded.status).toBe(session.status);
      expect(loaded.currentPhase).toBe(session.currentPhase);
      expect(loaded.currentAgentIndex).toBe(session.currentAgentIndex);
      expect(loaded.completedAgents).toEqual(session.completedAgents);
      expect(loaded.startTime).toBe(session.startTime);
      expect(loaded.lastActivityTime).toBe(session.lastActivityTime);
    });
  });
});
