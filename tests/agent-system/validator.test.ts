import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateAgentDefinition } from '../../src/agent-system/validator.js';

const TEST_DIR = path.join(process.cwd(), '.test-agent-validator-tmp');

function writeAgentFile(name: string, content: string): void {
  fs.writeFileSync(path.join(TEST_DIR, name), content, 'utf-8');
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('validateAgentDefinition', () => {
  it('returns DIR_NOT_FOUND for nonexistent directory', () => {
    const result = validateAgentDefinition('/tmp/nonexistent-agent-dir-12345');
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('DIR_NOT_FOUND');
  });

  it('returns REQUIRED_FILE_MISSING when agent.md is absent', () => {
    writeAgentFile('context.md', '# Context');
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'REQUIRED_FILE_MISSING')).toBe(true);
  });

  it('validates minimum viable agent (only agent.md)', () => {
    writeAgentFile('agent.md', '# Test Agent\n\n## INTENT\nTest agent for validation.');
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('warns when agent.md exceeds token budget', () => {
    writeAgentFile('agent.md', 'x'.repeat(15000)); // 3750 tokens > 3000 limit
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(true); // warnings, not errors
    expect(result.warnings.some(w => w.code === 'TOKEN_BUDGET_EXCEEDED')).toBe(true);
    expect(result.tokenBreakdown['agent.md'].within).toBe(false);
  });

  it('warns when total tokens exceed controllable limit', () => {
    writeAgentFile('agent.md', 'a'.repeat(40000));    // 10000 tokens
    writeAgentFile('context.md', 'b'.repeat(40000));   // 10000 tokens
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.warnings.some(w => w.code === 'TOTAL_TOKEN_BUDGET_EXCEEDED')).toBe(true);
  });

  it('validates valid meta.json', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('meta.json', JSON.stringify({
      created: '2026-03-30T10:00:00Z',
      last_used: '2026-03-30T10:00:00Z',
      version: 1,
      author: 'user',
      invocation_count: 0,
    }));
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on invalid meta.json (missing required fields)', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('meta.json', JSON.stringify({ version: 'not-a-number' }));
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_META_JSON')).toBe(true);
  });

  it('errors on unparseable meta.json', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('meta.json', 'not json at all');
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'JSON_PARSE_ERROR')).toBe(true);
  });

  it('validates valid memory-keys.json', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('memory-keys.json', JSON.stringify({
      recall_queries: ['project/api/endpoint'],
      leann_queries: ['cache pattern'],
      tags: ['backend'],
    }));
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(true);
  });

  it('errors on invalid memory-keys.json (wrong types)', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('memory-keys.json', JSON.stringify({
      recall_queries: [123, true], // should be strings
    }));
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_MEMORY_KEYS')).toBe(true);
  });

  it('errors on unparseable memory-keys.json', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('memory-keys.json', '{invalid json}');
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'JSON_PARSE_ERROR')).toBe(true);
  });

  it('returns correct totalTokens for multiple files', () => {
    writeAgentFile('agent.md', 'a'.repeat(4000));    // 1000 tokens
    writeAgentFile('context.md', 'b'.repeat(8000));   // 2000 tokens
    writeAgentFile('tools.md', 'c'.repeat(2000));     // 500 tokens
    writeAgentFile('behavior.md', 'd'.repeat(1000));  // 250 tokens
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.totalTokens).toBe(3750);
  });

  it('does not count JSON files toward totalTokens', () => {
    writeAgentFile('agent.md', 'a'.repeat(400));  // 100 tokens
    writeAgentFile('meta.json', JSON.stringify({
      created: '2026-03-30T10:00:00Z',
      last_used: '2026-03-30T10:00:00Z',
      version: 1,
      author: 'user',
      invocation_count: 0,
    }));
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.totalTokens).toBe(100);
  });

  it('ignores unknown files in directory', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('README.md', '# Not an agent file');
    writeAgentFile('random.txt', 'random content');
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.tokenBreakdown)).not.toContain('README.md');
  });

  it('handles meta.json with Phase 4 quality block', () => {
    writeAgentFile('agent.md', '# Agent');
    writeAgentFile('meta.json', JSON.stringify({
      created: '2026-03-30T10:00:00Z',
      last_used: '2026-03-30T10:00:00Z',
      version: 1,
      author: 'user',
      invocation_count: 0,
      generation: 0,
      quality: {
        total_selections: 0,
        total_completions: 0,
        total_fallbacks: 0,
        applied_rate: 0.0,
        completion_rate: 0.0,
        effective_rate: 0.0,
        fallback_rate: 0.0,
      },
      evolution_history_last_10: [],
    }));
    const result = validateAgentDefinition(TEST_DIR);
    expect(result.valid).toBe(true);
  });
});
