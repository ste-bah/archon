import { describe, it, expect, beforeAll } from 'vitest';
import {
  ClaudeCodeExecutor,
  ClaudeCodeUnavailableError,
  ClaudeCodeExecutionError,
  ClaudeCodeTimeoutError
} from '../../../../src/god-agent/core/executor/index.js';
import type { ICodeExecutionRequest } from '../../../../src/god-agent/core/executor/executor-types.js';

/**
 * ClaudeCodeExecutor Integration Tests
 *
 * CRITICAL: These tests use REAL Claude Code CLI execution (RULE-CLI-001-004)
 * NO MOCKING of child_process, spawn, or CLI responses
 *
 * Tests skip gracefully when CLI is not available
 */
describe('ClaudeCodeExecutor', () => {
  let executor: ClaudeCodeExecutor;
  let cliAvailable: boolean;

  beforeAll(async () => {
    executor = new ClaudeCodeExecutor({ verbose: true });
    cliAvailable = await executor.isAvailable();

    if (!cliAvailable) {
      console.log('NOTE: Claude Code CLI not available, execution tests will be skipped');
      console.log('Install via: npm install -g @anthropic/claude-code');
    }
  });

  describe('isAvailable', () => {
    it('returns boolean indicating CLI availability', async () => {
      const available = await executor.isAvailable();

      expect(typeof available).toBe('boolean');
      console.log(`CLI available: ${available}`);
    });

    it('returns consistent results on repeated calls', async () => {
      const first = await executor.isAvailable();
      const second = await executor.isAvailable();

      expect(first).toBe(second);
    });
  });

  describe('getVersion', () => {
    it('returns version string when CLI available', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const version = await executor.getVersion();

      expect(version).toBeTruthy();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
      console.log(`Claude Code version: ${version}`);
    });

    it('caches version after first call', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const first = await executor.getVersion();
      const second = await executor.getVersion();

      expect(first).toBe(second);
      expect(first).toBeTruthy();
    });

    it('throws ClaudeCodeUnavailableError when CLI not found', async () => {
      // This test cannot force CLI unavailability without mocking
      // So we document the expected behavior
      if (cliAvailable) {
        console.log('SKIPPED: Cannot test unavailability when CLI is present');
        return;
      }

      // If CLI is not available, this should throw
      await expect(executor.getVersion()).rejects.toThrow(ClaudeCodeUnavailableError);
    });
  });

  describe('execute', () => {
    it('generates code for simple task', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const request: ICodeExecutionRequest = {
        task: 'Create a function that adds two numbers and returns the result',
        language: 'typescript',
        timeoutMs: 90000 // 90s for real CLI
      };

      const result = await executor.execute(request);

      expect(result).toBeDefined();
      expect(result.code).toBeTruthy();
      expect(typeof result.code).toBe('string');
      expect(result.language).toBe('typescript');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.exitCode).toBe(0);
      expect(result.metadata.durationMs).toBeGreaterThan(0);
      expect(result.rawOutput).toBeTruthy();

      // Verify code contains function-like structure
      const hasFunction = result.code.includes('function') ||
                         result.code.includes('const') ||
                         result.code.includes('=>');
      expect(hasFunction).toBe(true);

      console.log(`Generated ${result.code.length} chars in ${result.metadata.durationMs}ms`);
    }, 120000); // 120s timeout for real CLI execution

    it('throws ClaudeCodeExecutionError for empty task', async () => {
      const emptyRequest: ICodeExecutionRequest = { task: '' };

      await expect(executor.execute(emptyRequest))
        .rejects.toThrow(ClaudeCodeExecutionError);
    });

    it('throws ClaudeCodeExecutionError for whitespace-only task', async () => {
      const whitespaceRequest: ICodeExecutionRequest = { task: '   \n\t  ' };

      await expect(executor.execute(whitespaceRequest))
        .rejects.toThrow(ClaudeCodeExecutionError);
    });

    it('includes pattern context when provided', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const request: ICodeExecutionRequest = {
        task: 'Create a sorting function for an array of numbers',
        language: 'typescript',
        patternContext: '## Existing patterns:\n- Use quicksort algorithm for efficiency\n- Handle edge cases (empty array, single element)',
        timeoutMs: 90000
      };

      const result = await executor.execute(request);

      expect(result.code).toBeTruthy();
      expect(result.language).toBe('typescript');

      console.log(`Generated sorting function with pattern context`);
    }, 120000);

    it('handles user context correctly', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const request: ICodeExecutionRequest = {
        task: 'Create a hello world function',
        language: 'javascript',
        userContext: 'Use arrow function syntax',
        timeoutMs: 90000
      };

      const result = await executor.execute(request);

      expect(result.code).toBeTruthy();
      expect(result.language).toBe('javascript');

      console.log(`Generated with user context`);
    }, 120000);

    it('respects timeout configuration', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      // Very short timeout to trigger timeout error
      const shortTimeoutExecutor = new ClaudeCodeExecutor({
        defaultTimeoutMs: 100 // 100ms - too short for real execution
      });

      const request: ICodeExecutionRequest = {
        task: 'Create a complex sorting algorithm with detailed documentation'
      };

      await expect(shortTimeoutExecutor.execute(request))
        .rejects.toThrow(); // Will timeout
    }, 10000);

    it('handles multiple language targets', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const languages = ['typescript', 'python', 'javascript'];

      for (const lang of languages) {
        const request: ICodeExecutionRequest = {
          task: 'Create a hello world function',
          language: lang,
          timeoutMs: 90000
        };

        const result = await executor.execute(request);

        expect(result.language).toBe(lang);
        expect(result.code).toBeTruthy();
        console.log(`Generated ${lang} code successfully`);
      }
    }, 300000); // 5 minutes for 3 executions

    it('returns valid execution metadata', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const request: ICodeExecutionRequest = {
        task: 'Create a simple function',
        language: 'typescript',
        timeoutMs: 90000
      };

      const result = await executor.execute(request);

      expect(result.metadata.durationMs).toBeGreaterThan(0);
      expect(result.metadata.exitCode).toBe(0);
      expect(result.metadata.startedAt).toBeInstanceOf(Date);
      expect(result.metadata.completedAt).toBeInstanceOf(Date);
      expect(result.metadata.completedAt.getTime()).toBeGreaterThanOrEqual(
        result.metadata.startedAt.getTime()
      );
      expect(result.metadata.cliVersion).toBeTruthy();
    }, 120000);

    it('includes examples in request when provided', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const request: ICodeExecutionRequest = {
        task: 'Create a validation function',
        language: 'typescript',
        examples: [
          'validate("test@example.com") // returns true',
          'validate("invalid") // returns false'
        ],
        timeoutMs: 90000
      };

      const result = await executor.execute(request);

      expect(result.code).toBeTruthy();
      console.log(`Generated validation function with examples`);
    }, 120000);

    it('respects constraints in request', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const request: ICodeExecutionRequest = {
        task: 'Create a database query function',
        language: 'typescript',
        constraints: [
          'Must use parameterized queries',
          'Must handle errors gracefully',
          'Must include TypeScript types'
        ],
        timeoutMs: 90000
      };

      const result = await executor.execute(request);

      expect(result.code).toBeTruthy();
      console.log(`Generated with constraints applied`);
    }, 120000);
  });

  describe('error handling', () => {
    it('error classes include remediation', () => {
      const errors = [
        new ClaudeCodeUnavailableError(),
        new ClaudeCodeTimeoutError(5000),
        new ClaudeCodeExecutionError(1, 'test error')
      ];

      for (const error of errors) {
        expect(error.remediation).toBeDefined();
        expect(Array.isArray(error.remediation)).toBe(true);
        expect(error.remediation.length).toBeGreaterThan(0);
      }
    });

    it('errors serialize to JSON correctly', () => {
      const error = new ClaudeCodeExecutionError(
        1,
        'Authentication failed',
        'Partial output'
      );

      const json = error.toJSON();

      expect(json.name).toBe('ClaudeCodeExecutionError');
      expect(json.code).toBe('CLI_EXECUTION_FAILED');
      expect(json.message).toContain('exit code 1');
      expect(json.remediation).toBeDefined();
      expect(json.context).toEqual({
        exitCode: 1,
        stderr: 'Authentication failed',
        stdout: 'Partial output'
      });
    });

    it('timeout error includes partial output', () => {
      const partialOutput = 'Some partial result before timeout';
      const error = new ClaudeCodeTimeoutError(30000, partialOutput);

      expect(error.partialOutput).toBe(partialOutput);
      expect(error.timeoutMs).toBe(30000);
      expect(error.message).toContain('30000ms');
      expect(error.context?.partialOutput).toBe(partialOutput);
    });
  });

  describe('configuration', () => {
    it('accepts custom configuration', () => {
      const config = {
        defaultTimeoutMs: 45000,
        maxTaskLength: 5000,
        verbose: true,
        cwd: '/tmp'
      };

      const customExecutor = new ClaudeCodeExecutor(config);

      expect(customExecutor).toBeDefined();
    });

    it('uses default values when config not provided', () => {
      const defaultExecutor = new ClaudeCodeExecutor();

      expect(defaultExecutor).toBeDefined();
    });

    it('truncates long tasks', async () => {
      if (!cliAvailable) {
        console.log('SKIPPED: CLI not available');
        return;
      }

      const longTaskExecutor = new ClaudeCodeExecutor({
        maxTaskLength: 50, // Very short limit
        verbose: true
      });

      const longTask = 'Create a function that does something. '.repeat(100);
      const request: ICodeExecutionRequest = {
        task: longTask,
        language: 'typescript',
        timeoutMs: 90000
      };

      // Should not throw, but task will be truncated
      const result = await longTaskExecutor.execute(request);
      expect(result.code).toBeTruthy();
    }, 120000);
  });
});
