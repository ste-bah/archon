import { describe, it, expect } from 'vitest';
import { sanitizeAgentName, agentExists } from '../../src/agent-system/name-utils.js';

describe('sanitizeAgentName', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(sanitizeAgentName('SEC Filing Analyzer')).toBe('sec-filing-analyzer');
  });

  it('converts underscores to hyphens', () => {
    expect(sanitizeAgentName('my_cool_agent')).toBe('my-cool-agent');
  });

  it('strips special characters', () => {
    expect(sanitizeAgentName('agent!!!name###here')).toBe('agentnamehere');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeAgentName('a--b--c')).toBe('a-b-c');
  });

  it('strips leading digits', () => {
    expect(sanitizeAgentName('123-agent')).toBe('agent');
  });

  it('strips leading and trailing hyphens', () => {
    expect(sanitizeAgentName('-agent-')).toBe('agent');
  });

  it('handles mixed case with special chars', () => {
    expect(sanitizeAgentName('My Agent (v2.0)')).toBe('my-agent-v20');
  });

  it('truncates to 50 characters', () => {
    const longName = 'a'.repeat(60);
    const result = sanitizeAgentName(longName);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('removes trailing hyphen after truncation', () => {
    // 49 a's + hyphen at position 50 → truncate → strip trailing hyphen
    const name = 'a'.repeat(49) + '-bbb';
    const result = sanitizeAgentName(name);
    expect(result.endsWith('-')).toBe(false);
  });

  it('throws on empty string', () => {
    expect(() => sanitizeAgentName('')).toThrow('Agent name cannot be empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => sanitizeAgentName('   ')).toThrow('Agent name cannot be empty');
  });

  it('throws on single character result (too short)', () => {
    expect(() => sanitizeAgentName('a')).toThrow('too short');
  });

  it('sanitizes _template to template (underscore stripped, not reserved after sanitization)', () => {
    // _template is a reserved DIRECTORY name, but after sanitization it becomes "template"
    // which is a valid agent name. Collision detection (agentExists) catches the actual
    // directory conflict in TASK-AGT-004, not here.
    expect(sanitizeAgentName('_template')).toBe('template');
  });

  it('throws on reserved name archived', () => {
    expect(() => sanitizeAgentName('archived')).toThrow('reserved');
  });

  it('throws on reserved name versions', () => {
    expect(() => sanitizeAgentName('versions')).toThrow('reserved');
  });

  it('throws on reserved name traces', () => {
    expect(() => sanitizeAgentName('traces')).toThrow('reserved');
  });

  it('throws on reserved name custom', () => {
    expect(() => sanitizeAgentName('custom')).toThrow('reserved');
  });

  it('produces result matching the name pattern', () => {
    const pattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;
    const inputs = [
      'SEC Filing Analyzer',
      'my_cool_agent',
      'Code Review Tool v3',
      'agent-for-testing',
      'UPPERCASE NAME',
    ];
    for (const input of inputs) {
      const result = sanitizeAgentName(input);
      expect(result).toMatch(pattern);
    }
  });

  it('throws when all characters are stripped (only digits and special chars)', () => {
    expect(() => sanitizeAgentName('123!!!')).toThrow('too short');
  });
});

describe('agentExists', () => {
  it('returns true for existing directory', () => {
    expect(agentExists('_template', '.claude/agents/custom')).toBe(true);
  });

  it('returns false for nonexistent directory', () => {
    expect(agentExists('nonexistent-agent-xyz', '.claude/agents/custom')).toBe(false);
  });

  it('throws on path traversal attempt', () => {
    expect(() => agentExists('../etc', '.claude/agents/custom')).toThrow('path separators');
    expect(() => agentExists('foo/bar', '.claude/agents/custom')).toThrow('path separators');
    expect(() => agentExists('foo\\bar', '.claude/agents/custom')).toThrow('path separators');
  });
});
