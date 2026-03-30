/**
 * SessionManager - Handles pipeline session persistence
 * Implements REQ-PIPE-020, REQ-PIPE-021, REQ-PIPE-022, REQ-PIPE-023
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { validate as isValidUUID } from 'uuid';
import type { PipelineSession, SessionStatus } from './cli-types.js';

const SESSION_DIR = '.phd-sessions';
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_WRITE_RETRIES = 3;
const RETRY_DELAY_MS = 100;

/**
 * SessionManager class for pipeline session persistence
 */
export class SessionManager {
  private sessionDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.sessionDir = path.join(baseDir, SESSION_DIR);
  }

  /**
   * Create new session object with initial state
   * [REQ-PIPE-020, REQ-PIPE-021, REQ-PIPE-023]
   */
  createSession(
    sessionId: string,
    query: string,
    styleProfileId: string,
    pipelineId: string
  ): PipelineSession {
    // Validate UUID v4 format
    if (!isValidUUID(sessionId)) {
      throw new Error(`Invalid session ID format: ${sessionId}`);
    }

    const now = Date.now();

    return {
      sessionId,
      pipelineId,
      query,
      styleProfileId,
      status: 'running',
      currentPhase: 1,
      currentAgentIndex: 0,
      completedAgents: [],
      agentOutputs: {},
      startTime: now,
      lastActivityTime: now,
      errors: []
    };
  }

  /**
   * Save session to disk with atomic write pattern
   * Uses temp file + rename to prevent corruption
   * [REQ-PIPE-020]
   */
  async saveSession(session: PipelineSession): Promise<void> {
    // Ensure directory exists
    await this.ensureSessionDirectory();

    const sessionPath = this.getSessionPath(session.sessionId);
    const tempPath = `${sessionPath}.tmp`;

    // Serialize session
    const json = JSON.stringify(session, null, 2);

    // Retry logic for disk failures
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
      try {
        // Write to temp file
        await fs.writeFile(tempPath, json, 'utf-8');

        // Atomic rename
        await fs.rename(tempPath, sessionPath);

        return; // Success
      } catch (error) {
        lastError = error as Error;

        if (attempt < MAX_WRITE_RETRIES) {
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }

    // All retries failed
    throw new SessionPersistError(
      `Failed to save session after ${MAX_WRITE_RETRIES} attempts: ${lastError?.message}`,
      session
    );
  }

  /**
   * Load session from disk with validation
   * [REQ-PIPE-020]
   */
  async loadSession(sessionId: string): Promise<PipelineSession> {
    // Validate UUID format
    if (!isValidUUID(sessionId)) {
      throw new SessionNotFoundError(sessionId);
    }

    const sessionPath = this.getSessionPath(sessionId);

    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      const session = JSON.parse(content) as PipelineSession;

      // Validate required fields
      this.validateSession(session);

      return session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SessionNotFoundError(sessionId);
      }

      if (error instanceof SyntaxError) {
        throw new SessionCorruptedError(sessionId);
      }

      throw error;
    }
  }

  /**
   * Check if session exists on disk
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    if (!isValidUUID(sessionId)) {
      return false;
    }

    try {
      await fs.access(this.getSessionPath(sessionId));
      return true;
    } catch {
      // INTENTIONAL: File access failure means session doesn't exist - false is correct response
      return false;
    }
  }

  /**
   * Check if session has expired (inactive > 24 hours)
   * [REQ-PIPE-022]
   */
  isSessionExpired(session: PipelineSession): boolean {
    const now = Date.now();
    const elapsed = now - session.lastActivityTime;
    return elapsed > SESSION_EXPIRY_MS;
  }

  /**
   * Update session's lastActivityTime
   * Used by next command to keep session alive
   * [REQ-PIPE-002]
   */
  async updateActivity(session: PipelineSession): Promise<void> {
    session.lastActivityTime = Date.now();
    await this.saveSession(session);
  }

  /**
   * Get sessions active within last N days
   * Default: 7 days for list command
   */
  async listSessions(options: { includeAll?: boolean; maxAgeDays?: number } = {}): Promise<PipelineSession[]> {
    const { includeAll = false, maxAgeDays = 7 } = options;

    await this.ensureSessionDirectory();

    const files = await fs.readdir(this.sessionDir);
    const sessionFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));

    const sessions: PipelineSession[] = [];
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const file of sessionFiles) {
      try {
        const sessionId = file.replace('.json', '');
        const session = await this.loadSession(sessionId);

        // Filter by age unless includeAll
        if (includeAll) {
          sessions.push(session);
        } else {
          const age = now - session.lastActivityTime;
          if (age <= maxAgeMs) {
            sessions.push(session);
          }
        }
      } catch (error) {
        // Skip corrupted sessions silently
        if (error instanceof SessionCorruptedError || error instanceof SessionNotFoundError) {
          continue;
        }
        throw error;
      }
    }

    // Sort by lastActivityTime descending (most recent first)
    sessions.sort((a, b) => b.lastActivityTime - a.lastActivityTime);

    return sessions;
  }


  /**
   * Update session status
   */
  async updateStatus(session: PipelineSession, status: SessionStatus): Promise<void> {
    session.status = status;
    session.lastActivityTime = Date.now();
    await this.saveSession(session);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!isValidUUID(sessionId)) {
      throw new SessionNotFoundError(sessionId);
    }

    const sessionPath = this.getSessionPath(sessionId);

    try {
      await fs.unlink(sessionPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SessionNotFoundError(sessionId);
      }
      throw error;
    }
  }

  /**
   * Get most recently active session
   */
  async getMostRecentSession(): Promise<PipelineSession | null> {
    const sessions = await this.listSessions({ maxAgeDays: 1 });
    return sessions.length > 0 ? sessions[0] : null;
  }

  /**
   * Get session directory path
   */
  getSessionDirectory(): string {
    return this.sessionDir;
  }

  /**
   * Helper: Get session file path
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionDir, `${sessionId}.json`);
  }

  /**
   * Helper: Ensure session directory exists
   */
  private async ensureSessionDirectory(): Promise<void> {
    try {
      await fs.access(this.sessionDir);
    } catch {
      // INTENTIONAL: Directory doesn't exist - create it (this is expected on first run)
      await fs.mkdir(this.sessionDir, { recursive: true });
    }
  }

  /**
   * Helper: Validate session structure
   */
  private validateSession(session: unknown): asserts session is PipelineSession {
    if (typeof session !== 'object' || session === null) {
      throw new Error('Invalid session: not an object');
    }

    const required = [
      'sessionId', 'pipelineId', 'query', 'styleProfileId', 'status',
      'currentPhase', 'currentAgentIndex', 'completedAgents',
      'startTime', 'lastActivityTime'
    ];

    for (const field of required) {
      if (!(field in session)) {
        throw new Error(`Invalid session: missing field ${field}`);
      }
    }
  }

  /**
   * Helper: Sleep utility for retry delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Session not found error
 */
export class SessionNotFoundError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * Session corrupted error (invalid JSON)
 */
export class SessionCorruptedError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session corrupted: ${sessionId}`);
    this.name = 'SessionCorruptedError';
    this.sessionId = sessionId;
  }
}

/**
 * Session persist error (disk write failure)
 */
export class SessionPersistError extends Error {
  public readonly session: PipelineSession;

  constructor(message: string, session: PipelineSession) {
    super(message);
    this.name = 'SessionPersistError';
    this.session = session;
  }
}

/**
 * Session expired error
 */
export class SessionExpiredError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session expired (inactive >24h): ${sessionId}`);
    this.name = 'SessionExpiredError';
    this.sessionId = sessionId;
  }
}
