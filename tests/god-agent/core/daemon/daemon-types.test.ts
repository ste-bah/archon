/**
 * Daemon Types Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-001
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SOCKET_PATH,
  MAX_CLIENTS,
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_DAEMON_CONFIG,
  DaemonErrorCode,
  ClientRejectionReason,
  createDaemonError,
  generateClientId,
  isDaemonError,
} from '../../../../src/god-agent/core/daemon/daemon-types.js';

describe('daemon-types', () => {
  describe('constants', () => {
    it('should have correct default socket path', () => {
      expect(DEFAULT_SOCKET_PATH).toBe('/tmp/godagent-db.sock');
    });

    it('should have max clients of 10', () => {
      expect(MAX_CLIENTS).toBe(10);
    });

    it('should have 30 second keepalive timeout', () => {
      expect(DEFAULT_KEEPALIVE_TIMEOUT_MS).toBe(30_000);
    });

    it('should have 5 second graceful shutdown timeout', () => {
      expect(GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBe(5_000);
    });
  });

  describe('DEFAULT_DAEMON_CONFIG', () => {
    it('should have all required properties', () => {
      expect(DEFAULT_DAEMON_CONFIG).toHaveProperty('socketPath');
      expect(DEFAULT_DAEMON_CONFIG).toHaveProperty('maxClients');
      expect(DEFAULT_DAEMON_CONFIG).toHaveProperty('keepAliveTimeout');
    });

    it('should use default values', () => {
      expect(DEFAULT_DAEMON_CONFIG.socketPath).toBe(DEFAULT_SOCKET_PATH);
      expect(DEFAULT_DAEMON_CONFIG.maxClients).toBe(MAX_CLIENTS);
      expect(DEFAULT_DAEMON_CONFIG.keepAliveTimeout).toBe(DEFAULT_KEEPALIVE_TIMEOUT_MS);
    });
  });

  describe('DaemonErrorCode', () => {
    it('should have SOCKET_EXISTS code', () => {
      expect(DaemonErrorCode.SOCKET_EXISTS).toBe('EADDRINUSE');
    });

    it('should have PERMISSION_DENIED code', () => {
      expect(DaemonErrorCode.PERMISSION_DENIED).toBe('EACCES');
    });

    it('should have CONNECTION_ERROR code', () => {
      expect(DaemonErrorCode.CONNECTION_ERROR).toBe('ECONNREFUSED');
    });

    it('should have TIMEOUT code', () => {
      expect(DaemonErrorCode.TIMEOUT).toBe('ETIMEDOUT');
    });

    it('should have UNKNOWN code', () => {
      expect(DaemonErrorCode.UNKNOWN).toBe('UNKNOWN');
    });
  });

  describe('ClientRejectionReason', () => {
    it('should have MAX_CLIENTS_EXCEEDED reason', () => {
      expect(ClientRejectionReason.MAX_CLIENTS_EXCEEDED).toBe('MAX_CLIENTS_EXCEEDED');
    });

    it('should have SERVER_SHUTTING_DOWN reason', () => {
      expect(ClientRejectionReason.SERVER_SHUTTING_DOWN).toBe('SERVER_SHUTTING_DOWN');
    });

    it('should have INVALID_STATE reason', () => {
      expect(ClientRejectionReason.INVALID_STATE).toBe('INVALID_STATE');
    });
  });

  describe('createDaemonError', () => {
    it('should create error with code', () => {
      const error = createDaemonError(
        DaemonErrorCode.SOCKET_EXISTS,
        'Socket exists'
      );
      expect(error.code).toBe(DaemonErrorCode.SOCKET_EXISTS);
      expect(error.message).toBe('Socket exists');
    });

    it('should set error name to DaemonError', () => {
      const error = createDaemonError(
        DaemonErrorCode.UNKNOWN,
        'Unknown error'
      );
      expect(error.name).toBe('DaemonError');
    });

    it('should include context when provided', () => {
      const context = { socketPath: '/tmp/test.sock' };
      const error = createDaemonError(
        DaemonErrorCode.PERMISSION_DENIED,
        'Permission denied',
        context
      );
      expect(error.context).toEqual(context);
    });

    it('should work without context', () => {
      const error = createDaemonError(
        DaemonErrorCode.TIMEOUT,
        'Timeout occurred'
      );
      expect(error.context).toBeUndefined();
    });
  });

  describe('generateClientId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateClientId();
      const id2 = generateClientId();
      expect(id1).not.toBe(id2);
    });

    it('should start with client_ prefix', () => {
      const id = generateClientId();
      expect(id).toMatch(/^client_/);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const id = generateClientId();
      const after = Date.now();

      const parts = id.split('_');
      const timestamp = parseInt(parts[1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should include random suffix', () => {
      const id = generateClientId();
      const parts = id.split('_');
      expect(parts[2]).toHaveLength(6);
    });
  });

  describe('isDaemonError', () => {
    it('should return true for daemon errors', () => {
      const error = createDaemonError(
        DaemonErrorCode.SOCKET_EXISTS,
        'Test error'
      );
      expect(isDaemonError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isDaemonError(error)).toBe(false);
    });

    it('should return false for non-error objects', () => {
      expect(isDaemonError('string')).toBe(false);
      expect(isDaemonError(null)).toBe(false);
      expect(isDaemonError(undefined)).toBe(false);
      expect(isDaemonError({})).toBe(false);
    });

    it('should return true for errors with valid daemon error codes', () => {
      const fakeError = new Error('fake') as any;
      fakeError.code = DaemonErrorCode.PERMISSION_DENIED;
      expect(isDaemonError(fakeError)).toBe(true);
    });

    it('should return false for errors with invalid codes', () => {
      const fakeError = new Error('fake') as any;
      fakeError.code = 'INVALID_CODE';
      expect(isDaemonError(fakeError)).toBe(false);
    });
  });
});
