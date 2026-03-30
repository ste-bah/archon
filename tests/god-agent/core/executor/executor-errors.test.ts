import { describe, it, expect } from 'vitest';
import {
  ClaudeCodeError,
  ClaudeCodeUnavailableError,
  ClaudeCodeTimeoutError,
  ClaudeCodeExecutionError,
  ClaudeCodeParseError
} from '../../../../src/god-agent/core/executor/executor-errors.js';

describe('ClaudeCodeError', () => {
  describe('ClaudeCodeUnavailableError', () => {
    it('creates instance with default message', () => {
      const error = new ClaudeCodeUnavailableError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ClaudeCodeError);
      expect(error.message).toBe('Claude Code CLI not found in PATH');
    });

    it('creates instance with custom message', () => {
      const customMessage = 'CLI installation corrupted';
      const error = new ClaudeCodeUnavailableError(customMessage);

      expect(error.message).toBe(customMessage);
    });

    it('has correct error code', () => {
      const error = new ClaudeCodeUnavailableError();

      expect(error.code).toBe('CLI_UNAVAILABLE');
    });

    it('includes remediation steps', () => {
      const error = new ClaudeCodeUnavailableError();

      expect(error.remediation).toBeDefined();
      expect(Array.isArray(error.remediation)).toBe(true);
      expect(error.remediation.length).toBeGreaterThan(0);
      expect(error.remediation).toContain('Install Claude Code CLI: npm install -g @anthropic/claude-code');
    });

    it('serializes to JSON correctly', () => {
      const error = new ClaudeCodeUnavailableError();
      const json = error.toJSON();

      expect(json.name).toBe('ClaudeCodeUnavailableError');
      expect(json.code).toBe('CLI_UNAVAILABLE');
      expect(json.message).toBe('Claude Code CLI not found in PATH');
      expect(json.remediation).toEqual(error.remediation);
    });
  });

  describe('ClaudeCodeTimeoutError', () => {
    it('creates instance with timeout value', () => {
      const timeout = 30000;
      const error = new ClaudeCodeTimeoutError(timeout);

      expect(error).toBeInstanceOf(ClaudeCodeError);
      expect(error.message).toBe('Claude Code CLI execution timed out after 30000ms');
      expect(error.timeoutMs).toBe(timeout);
    });

    it('creates instance with timeout and partial output', () => {
      const timeout = 5000;
      const partialOutput = 'Some partial result...';
      const error = new ClaudeCodeTimeoutError(timeout, partialOutput);

      expect(error.timeoutMs).toBe(timeout);
      expect(error.partialOutput).toBe(partialOutput);
    });

    it('has correct error code', () => {
      const error = new ClaudeCodeTimeoutError(10000);

      expect(error.code).toBe('CLI_TIMEOUT');
    });

    it('includes remediation steps', () => {
      const error = new ClaudeCodeTimeoutError(10000);

      expect(error.remediation).toBeDefined();
      expect(Array.isArray(error.remediation)).toBe(true);
      expect(error.remediation.length).toBeGreaterThan(0);
      expect(error.remediation.some(r => r.includes('timeout'))).toBe(true);
    });

    it('sets context property correctly', () => {
      const timeout = 15000;
      const partialOutput = 'Partial data';
      const error = new ClaudeCodeTimeoutError(timeout, partialOutput);

      expect(error.context).toBeDefined();
      expect(error.context?.timeoutMs).toBe(timeout);
      expect(error.context?.partialOutput).toBe(partialOutput);
    });

    it('serializes to JSON with context', () => {
      const timeout = 20000;
      const partialOutput = 'Beginning of output...';
      const error = new ClaudeCodeTimeoutError(timeout, partialOutput);
      const json = error.toJSON();

      expect(json.name).toBe('ClaudeCodeTimeoutError');
      expect(json.code).toBe('CLI_TIMEOUT');
      expect(json.context).toEqual({ timeoutMs: timeout, partialOutput });
    });
  });

  describe('ClaudeCodeExecutionError', () => {
    it('creates instance with exit code and stderr', () => {
      const exitCode = 1;
      const stderr = 'Error: Command failed';
      const error = new ClaudeCodeExecutionError(exitCode, stderr);

      expect(error).toBeInstanceOf(ClaudeCodeError);
      expect(error.message).toBe('Claude Code CLI failed with exit code 1');
      expect(error.exitCode).toBe(exitCode);
      expect(error.stderr).toBe(stderr);
    });

    it('creates instance with exit code, stderr, and stdout', () => {
      const exitCode = 2;
      const stderr = 'Fatal error';
      const stdout = 'Some output before failure';
      const error = new ClaudeCodeExecutionError(exitCode, stderr, stdout);

      expect(error.exitCode).toBe(exitCode);
      expect(error.stderr).toBe(stderr);
      expect(error.stdout).toBe(stdout);
    });

    it('has correct error code', () => {
      const error = new ClaudeCodeExecutionError(1, 'error');

      expect(error.code).toBe('CLI_EXECUTION_FAILED');
    });

    it('includes remediation steps', () => {
      const error = new ClaudeCodeExecutionError(1, 'error');

      expect(error.remediation).toBeDefined();
      expect(Array.isArray(error.remediation)).toBe(true);
      expect(error.remediation.length).toBeGreaterThan(0);
      expect(error.remediation.some(r => r.includes('stderr'))).toBe(true);
    });

    it('sets context property with all properties', () => {
      const exitCode = 3;
      const stderr = 'Authentication failed';
      const stdout = 'Partial result';
      const error = new ClaudeCodeExecutionError(exitCode, stderr, stdout);

      expect(error.context).toBeDefined();
      expect(error.context?.exitCode).toBe(exitCode);
      expect(error.context?.stderr).toBe(stderr);
      expect(error.context?.stdout).toBe(stdout);
    });

    it('serializes to JSON with all context', () => {
      const exitCode = 127;
      const stderr = 'Command not found';
      const stdout = '';
      const error = new ClaudeCodeExecutionError(exitCode, stderr, stdout);
      const json = error.toJSON();

      expect(json.name).toBe('ClaudeCodeExecutionError');
      expect(json.code).toBe('CLI_EXECUTION_FAILED');
      expect(json.message).toContain('127');
      expect(json.context).toEqual({ exitCode, stderr, stdout });
    });
  });

  describe('ClaudeCodeParseError', () => {
    it('creates instance with message and raw output', () => {
      const message = 'Invalid JSON format';
      const rawOutput = '{ incomplete json';
      const error = new ClaudeCodeParseError(message, rawOutput);

      expect(error).toBeInstanceOf(ClaudeCodeError);
      expect(error.message).toBe(message);
      expect(error.rawOutput).toBe(rawOutput);
    });

    it('has correct error code', () => {
      const error = new ClaudeCodeParseError('Parse failed', 'output');

      expect(error.code).toBe('CLI_PARSE_FAILED');
    });

    it('includes remediation steps', () => {
      const error = new ClaudeCodeParseError('Parse failed', 'output');

      expect(error.remediation).toBeDefined();
      expect(Array.isArray(error.remediation)).toBe(true);
      expect(error.remediation.length).toBeGreaterThan(0);
      expect(error.remediation.some(r => r.includes('format'))).toBe(true);
    });

    it('sets context property with raw output', () => {
      const rawOutput = 'Malformed output data';
      const error = new ClaudeCodeParseError('Cannot parse', rawOutput);

      expect(error.context).toBeDefined();
      expect(error.context?.rawOutput).toBe(rawOutput);
    });

    it('serializes to JSON with raw output', () => {
      const message = 'Unexpected format';
      const rawOutput = '<<<invalid>>>';
      const error = new ClaudeCodeParseError(message, rawOutput);
      const json = error.toJSON();

      expect(json.name).toBe('ClaudeCodeParseError');
      expect(json.code).toBe('CLI_PARSE_FAILED');
      expect(json.message).toBe(message);
      expect(json.context).toEqual({ rawOutput });
    });
  });

  describe('Error inheritance', () => {
    it('all errors extend ClaudeCodeError', () => {
      const errors = [
        new ClaudeCodeUnavailableError(),
        new ClaudeCodeTimeoutError(5000),
        new ClaudeCodeExecutionError(1, 'error'),
        new ClaudeCodeParseError('error', 'output')
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(ClaudeCodeError);
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('all errors have stack trace', () => {
      const errors = [
        new ClaudeCodeUnavailableError(),
        new ClaudeCodeTimeoutError(5000),
        new ClaudeCodeExecutionError(1, 'error'),
        new ClaudeCodeParseError('error', 'output')
      ];

      for (const error of errors) {
        expect(error.stack).toBeDefined();
        expect(typeof error.stack).toBe('string');
      }
    });

    it('all errors have name matching class name', () => {
      const testCases = [
        { error: new ClaudeCodeUnavailableError(), name: 'ClaudeCodeUnavailableError' },
        { error: new ClaudeCodeTimeoutError(5000), name: 'ClaudeCodeTimeoutError' },
        { error: new ClaudeCodeExecutionError(1, 'error'), name: 'ClaudeCodeExecutionError' },
        { error: new ClaudeCodeParseError('error', 'output'), name: 'ClaudeCodeParseError' }
      ];

      for (const { error, name } of testCases) {
        expect(error.name).toBe(name);
      }
    });
  });
});
