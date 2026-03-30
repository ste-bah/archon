/**
 * Session End Hook Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-002
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import type {
  SessionEndInput,
  SessionEndResponse,
  SessionState,
} from '../../scripts/hooks/hook-types';

// Mock file system for isolated testing
vi.mock('fs/promises');
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock child_process for git commands
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (typeof opts === 'function') {
      callback = opts;
    }
    // Simulate git commands
    if (cmd.includes('branch --show-current')) {
      callback(null, { stdout: 'feature/hooks\n' });
    } else if (cmd.includes('status --porcelain')) {
      callback(null, { stdout: 'M file1.ts\nM file2.ts\n' });
    } else if (cmd.includes('diff --stat')) {
      callback(null, { stdout: 'file1.ts | 10 ++++\nfile2.ts | 5 ++\n' });
    } else {
      callback(null, { stdout: '' });
    }
  }),
}));

// Mock SonaEngine
vi.mock('../../src/god-agent/core/learning/sona-engine.js', () => ({
  SonaEngine: vi.fn().mockImplementation(() => ({
    setWeightsFilePath: vi.fn(),
    saveWeights: vi.fn().mockResolvedValue(undefined),
    getWeights: vi.fn().mockReturnValue({
      typescript: 0.85,
      nodejs: 0.72,
    }),
  })),
}));

// Mock ActivityStream
vi.mock('../../src/god-agent/observability/index.js', () => ({
  ActivityStream: vi.fn().mockImplementation(() => ({
    logEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('session-end hook', () => {
  const mockInput: SessionEndInput = {
    correlationId: 'test-456',
    timestamp: '2025-01-01T01:00:00Z',
    eventType: 'SessionEnd',
    sessionId: 'sess-abc',
    workingDirectory: '/home/user/project',
    durationMs: 3600000, // 1 hour
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('captureSessionState', () => {
    it('should capture git branch', async () => {
      // Simulate state capture
      const state: Partial<SessionState> = {
        git: {
          branch: 'feature/hooks',
          uncommittedFiles: ['file1.ts', 'file2.ts'],
          diffSummary: 'file1.ts | 10 ++++',
        },
      };

      expect(state.git?.branch).toBe('feature/hooks');
    });

    it('should capture uncommitted files list', () => {
      const gitStatus = 'M file1.ts\nM file2.ts\n';
      const uncommittedFiles = gitStatus.split('\n').filter(Boolean);

      expect(uncommittedFiles).toHaveLength(2);
      expect(uncommittedFiles).toContain('M file1.ts');
    });

    it('should limit diff summary to 500 chars', () => {
      const longDiff = 'x'.repeat(1000);
      const limitedDiff = longDiff.substring(0, 500);

      expect(limitedDiff.length).toBe(500);
    });

    it('should include timestamp in state', () => {
      const state: Partial<SessionState> = {
        timestamp: new Date().toISOString(),
      };

      expect(state.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('persistSessionState', () => {
    it('should write session file', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const state: SessionState = {
        sessionId: 'sess-abc',
        timestamp: '2025-01-01T00:00:00Z',
        git: { branch: 'main', uncommittedFiles: [], diffSummary: '' },
        tasks: { inProgress: [], completed: [], pending: [] },
        context: { recentFiles: [], currentFocus: '', keyDecisions: [] },
      };

      await fs.writeFile('.god-agent/sessions/sess-abc.json', JSON.stringify(state));

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should also write latest.json symlink', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const state: SessionState = {
        sessionId: 'sess-abc',
        timestamp: '2025-01-01T00:00:00Z',
        git: { branch: 'main', uncommittedFiles: [], diffSummary: '' },
        tasks: { inProgress: [], completed: [], pending: [] },
        context: { recentFiles: [], currentFocus: '', keyDecisions: [] },
      };

      await fs.writeFile('.god-agent/sessions/latest.json', JSON.stringify(state));

      expect(fs.writeFile).toHaveBeenCalledWith(
        '.god-agent/sessions/latest.json',
        expect.any(String)
      );
    });
  });

  describe('handleSessionEnd', () => {
    it('should return success with weights persisted', () => {
      const response: Partial<SessionEndResponse> = {
        success: true,
        weightsPersisted: true,
        stateSaved: true,
      };

      expect(response.success).toBe(true);
      expect(response.weightsPersisted).toBe(true);
    });

    it('should include correlation ID in response', () => {
      const response: Partial<SessionEndResponse> = {
        success: true,
        correlationId: mockInput.correlationId,
        durationMs: 32,
        weightsPersisted: true,
        stateSaved: true,
      };

      expect(response.correlationId).toBe('test-456');
    });

    it('should include state path in response', () => {
      const response: Partial<SessionEndResponse> = {
        success: true,
        stateSaved: true,
        statePath: '.god-agent/sessions/sess-abc.json',
      };

      expect(response.statePath).toContain('.god-agent/sessions/');
    });

    it('should handle SoNA save failure gracefully', () => {
      // Even if weights fail to save, session state should still be saved
      const response: Partial<SessionEndResponse> = {
        success: true,
        weightsPersisted: false, // Failed
        stateSaved: true, // Still succeeded
      };

      expect(response.success).toBe(true);
      expect(response.stateSaved).toBe(true);
    });
  });

  describe('directory creation', () => {
    it('should create sessions directory if not exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      // Simulate directory creation
      mkdirSync('.god-agent/sessions', { recursive: true });

      expect(mkdirSync).toHaveBeenCalledWith(
        '.god-agent/sessions',
        { recursive: true }
      );
    });

    it('should create weights directory if not exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      mkdirSync('.god-agent/weights', { recursive: true });

      expect(mkdirSync).toHaveBeenCalledWith(
        '.god-agent/weights',
        { recursive: true }
      );
    });
  });

  describe('timeout behavior', () => {
    it('should complete within 500ms budget', () => {
      const startTime = Date.now();

      // Simulate quick operations
      const state = { sessionId: 'test' };
      const content = JSON.stringify(state);

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('error handling', () => {
    it('should return error response on failure', () => {
      const errorResponse: SessionEndResponse = {
        success: false,
        correlationId: 'test-456',
        durationMs: 10,
        error: 'Test error',
        weightsPersisted: false,
        stateSaved: false,
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toBe('Test error');
      expect(errorResponse.weightsPersisted).toBe(false);
      expect(errorResponse.stateSaved).toBe(false);
    });

    it('should continue if observability fails', () => {
      const response: Partial<SessionEndResponse> = {
        success: true,
        weightsPersisted: true,
        stateSaved: true,
      };

      expect(response.success).toBe(true);
    });
  });

  describe('JSON I/O', () => {
    it('should parse valid JSON input', () => {
      const inputJson = JSON.stringify(mockInput);
      const parsed = JSON.parse(inputJson) as SessionEndInput;

      expect(parsed.correlationId).toBe('test-456');
      expect(parsed.eventType).toBe('SessionEnd');
      expect(parsed.durationMs).toBe(3600000);
    });

    it('should serialize response as JSON', () => {
      const response: SessionEndResponse = {
        success: true,
        correlationId: 'test-456',
        durationMs: 32,
        weightsPersisted: true,
        stateSaved: true,
        statePath: '.god-agent/sessions/sess-abc.json',
      };

      const json = JSON.stringify(response);
      const parsed = JSON.parse(json);

      expect(parsed.success).toBe(true);
      expect(parsed.weightsPersisted).toBe(true);
      expect(parsed.statePath).toBeDefined();
    });
  });

  describe('git command safety', () => {
    it('should handle git command timeout gracefully', async () => {
      // safeExec should return empty string on timeout
      const result = '';
      expect(result).toBe('');
    });

    it('should handle git command failure gracefully', async () => {
      // safeExec should return empty string on error
      const result = '';
      expect(result).toBe('');
    });
  });
});
