/**
 * Agent Errors Test Suite
 * TASK-001: DAI-001 Foundation Layer Tests
 *
 * Per constitution.md RULE-002: NO mock data - use real error scenarios
 * Tests verify error messages include full context and cause chain preservation.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentError,
  AgentDirectoryNotFoundError,
  AgentLoadError,
  AgentSelectionError,
  AgentExecutionError,
  DuplicateAgentKeyError,
  AgentRegistryNotInitializedError,
  AgentNotFoundError,
  AgentCategoryError,
} from '../../../../src/god-agent/core/agents/agent-errors.js';

describe('AgentError (Base Class)', () => {
  it('should instantiate with message', () => {
    const error = new AgentError('Test error message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentError');
    expect(error.message).toBe('Test error message');
  });

  it('should preserve cause for error chaining', () => {
    const originalError = new Error('Original failure');
    const error = new AgentError('Wrapper error', { cause: originalError });
    expect(error.originalCause).toBe(originalError);
  });

  it('should provide error chain via getErrorChain()', () => {
    const root = new Error('Root cause');
    const middle = new AgentError('Middle error', { cause: root });
    const top = new AgentError('Top level error', { cause: middle });

    const chain = top.getErrorChain();
    expect(chain).toHaveLength(3);
    expect(chain[0]).toContain('AgentError: Top level error');
    expect(chain[1]).toContain('Caused by: AgentError: Middle error');
    expect(chain[2]).toContain('Caused by: Error: Root cause');
  });
});

describe('AgentDirectoryNotFoundError', () => {
  it('should include path in error message', () => {
    const error = new AgentDirectoryNotFoundError('.claude/agents');
    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentDirectoryNotFoundError');
    expect(error.path).toBe('.claude/agents');
    expect(error.message).toContain('.claude/agents');
    expect(error.message).toContain('Agent directory not found');
    expect(error.message).toContain('Action:'); // Should include suggested action
  });
});

describe('AgentLoadError', () => {
  it('should include key, path, and cause in error message', () => {
    const parseError = new Error('Invalid YAML: unexpected token');
    const error = new AgentLoadError('my-agent', '.claude/agents/test/my-agent.md', parseError);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentLoadError');
    expect(error.agentKey).toBe('my-agent');
    expect(error.filePath).toBe('.claude/agents/test/my-agent.md');
    expect(error.originalCause).toBe(parseError);
    expect(error.message).toContain('my-agent');
    expect(error.message).toContain('.claude/agents/test/my-agent.md');
    expect(error.message).toContain('Invalid YAML');
  });

  it('should have accessible error chain', () => {
    const parseError = new Error('Parse failure');
    const error = new AgentLoadError('broken-agent', 'path/to/file.md', parseError);
    const chain = error.getErrorChain();

    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain[0]).toContain('AgentLoadError');
    expect(chain[1]).toContain('Parse failure');
  });
});

describe('AgentSelectionError', () => {
  it('should include task and available agents', () => {
    const availableAgents = ['coder', 'researcher', 'tester'];
    const error = new AgentSelectionError('write a poem about cats', availableAgents);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentSelectionError');
    expect(error.task).toBe('write a poem about cats');
    expect(error.availableAgents).toEqual(availableAgents);
    expect(error.message).toContain('write a poem about cats');
    expect(error.message).toContain('coder');
    expect(error.message).toContain('researcher');
    expect(error.message).toContain('tester');
  });

  it('should include analysis details when provided', () => {
    const error = new AgentSelectionError('implement login', ['coder'], {
      taskType: 'code',
      requiredCapabilities: ['authentication', 'security'],
    });

    expect(error.taskType).toBe('code');
    expect(error.requiredCapabilities).toEqual(['authentication', 'security']);
    expect(error.message).toContain('Task type detected: code');
    expect(error.message).toContain('authentication');
    expect(error.message).toContain('security');
  });

  it('should truncate long task descriptions', () => {
    const longTask = 'A'.repeat(200);
    const error = new AgentSelectionError(longTask, []);

    // Should truncate to ~100 chars with ...
    expect(error.message.length).toBeLessThan(longTask.length + 200);
    expect(error.message).toContain('...');
  });

  it('should handle empty available agents', () => {
    const error = new AgentSelectionError('any task', []);
    expect(error.message).toContain('none loaded');
  });

  it('should truncate large agent lists', () => {
    const manyAgents = Array.from({ length: 50 }, (_, i) => `agent-${i}`);
    const error = new AgentSelectionError('task', manyAgents);

    expect(error.message).toContain('50 total');
    // Should only show first 10
    expect(error.message).toContain('agent-0');
    expect(error.message).toContain('agent-9');
  });
});

describe('AgentExecutionError', () => {
  it('should include agent, task, and cause details', () => {
    const execError = new Error('Task timeout after 30s');
    const error = new AgentExecutionError(
      'researcher',
      'phdresearch',
      'analyze literature review',
      execError,
      30000
    );

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentExecutionError');
    expect(error.agentKey).toBe('researcher');
    expect(error.agentCategory).toBe('phdresearch');
    expect(error.task).toBe('analyze literature review');
    expect(error.duration).toBe(30000);
    expect(error.originalCause).toBe(execError);
    expect(error.message).toContain('researcher');
    expect(error.message).toContain('phdresearch');
    expect(error.message).toContain('Task timeout');
    expect(error.message).toContain('30000ms');
  });

  it('should work without duration', () => {
    const execError = new Error('Connection refused');
    const error = new AgentExecutionError('coder', 'core', 'generate code', execError);

    expect(error.duration).toBeUndefined();
    expect(error.message).not.toContain('Duration');
  });
});

describe('DuplicateAgentKeyError', () => {
  it('should include both paths for duplicate detection', () => {
    const error = new DuplicateAgentKeyError(
      'researcher',
      '.claude/agents/core/researcher.md',
      '.claude/agents/phdresearch/researcher.md'
    );

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('DuplicateAgentKeyError');
    expect(error.agentKey).toBe('researcher');
    expect(error.firstPath).toBe('.claude/agents/core/researcher.md');
    expect(error.duplicatePath).toBe('.claude/agents/phdresearch/researcher.md');
    expect(error.message).toContain('researcher');
    expect(error.message).toContain('kept');
    expect(error.message).toContain('skipped');
  });
});

describe('AgentRegistryNotInitializedError', () => {
  it('should include attempted operation', () => {
    const error = new AgentRegistryNotInitializedError('getByKey');

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentRegistryNotInitializedError');
    expect(error.message).toContain('getByKey');
    expect(error.message).toContain('initialize()');
  });
});

describe('AgentNotFoundError', () => {
  it('should include requested key and available keys', () => {
    const available = ['coder', 'tester', 'reviewer'];
    const error = new AgentNotFoundError('nonexistent-agent', available);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentNotFoundError');
    expect(error.agentKey).toBe('nonexistent-agent');
    expect(error.availableKeys).toEqual(available);
    expect(error.message).toContain('nonexistent-agent');
    expect(error.message).toContain('coder');
    expect(error.message).toContain('tester');
    expect(error.message).toContain('reviewer');
  });

  it('should truncate large key lists', () => {
    const manyKeys = Array.from({ length: 50 }, (_, i) => `key-${i}`);
    const error = new AgentNotFoundError('missing', manyKeys);

    expect(error.message).toContain('50 total');
  });
});

describe('AgentCategoryError', () => {
  it('should handle category not found', () => {
    const available = ['phdresearch', 'logicalcode', 'core'];
    const error = new AgentCategoryError('nonexistent', available, false);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentCategoryError');
    expect(error.category).toBe('nonexistent');
    expect(error.availableCategories).toEqual(available);
    expect(error.message).toContain('Category not found');
    expect(error.message).toContain('nonexistent');
    expect(error.message).toContain('phdresearch');
  });

  it('should handle empty category', () => {
    const error = new AgentCategoryError('empty-cat', ['other'], true);

    expect(error.message).toContain('Category is empty');
    expect(error.message).toContain('empty-cat');
  });
});

describe('Error inheritance chain', () => {
  it('all error types should be instances of AgentError', () => {
    const errors = [
      new AgentDirectoryNotFoundError('path'),
      new AgentLoadError('key', 'path', new Error('cause')),
      new AgentSelectionError('task', []),
      new AgentExecutionError('key', 'cat', 'task', new Error('cause')),
      new DuplicateAgentKeyError('key', 'path1', 'path2'),
      new AgentRegistryNotInitializedError('op'),
      new AgentNotFoundError('key', []),
      new AgentCategoryError('cat', []),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AgentError);
      expect(error.name).not.toBe('AgentError'); // Should have own name
      expect(error.name).not.toBe('Error');
    }
  });
});
