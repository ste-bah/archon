import { describe, it, expect } from 'vitest';
import { tokenEstimate, checkTokenBudget, computeTokenBreakdown } from '../../src/agent-system/token-counter.js';

describe('tokenEstimate', () => {
  it('returns 0 for empty string', () => {
    expect(tokenEstimate('')).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(tokenEstimate(null as unknown as string)).toBe(0);
    expect(tokenEstimate(undefined as unknown as string)).toBe(0);
  });

  it('estimates tokens as ceil(length / 4)', () => {
    expect(tokenEstimate('abcd')).toBe(1);       // 4 chars = 1 token
    expect(tokenEstimate('abcde')).toBe(2);      // 5 chars = 2 tokens (ceil)
    expect(tokenEstimate('a')).toBe(1);           // 1 char = 1 token
    expect(tokenEstimate('ab')).toBe(1);          // 2 chars = 1 token
    expect(tokenEstimate('abc')).toBe(1);         // 3 chars = 1 token
  });

  it('handles longer text', () => {
    const text = 'a'.repeat(4000);  // 4000 chars = 1000 tokens
    expect(tokenEstimate(text)).toBe(1000);
  });

  it('handles text with newlines and special chars', () => {
    const text = 'hello\nworld\n# Header\n- bullet';
    expect(tokenEstimate(text)).toBe(Math.ceil(text.length / 4));
  });
});

describe('checkTokenBudget', () => {
  it('returns within=true when under limit', () => {
    const result = checkTokenBudget('a'.repeat(100), 100);
    expect(result.within).toBe(true);
    expect(result.estimate).toBe(25);
    expect(result.limit).toBe(100);
    expect(result.overage).toBe(0);
  });

  it('returns within=false when over limit', () => {
    const result = checkTokenBudget('a'.repeat(100), 10);
    expect(result.within).toBe(false);
    expect(result.estimate).toBe(25);
    expect(result.limit).toBe(10);
    expect(result.overage).toBe(15);
  });

  it('returns within=true when exactly at limit', () => {
    const result = checkTokenBudget('a'.repeat(400), 100);
    expect(result.within).toBe(true);
    expect(result.estimate).toBe(100);
    expect(result.overage).toBe(0);
  });

  it('handles empty text', () => {
    const result = checkTokenBudget('', 100);
    expect(result.within).toBe(true);
    expect(result.estimate).toBe(0);
    expect(result.overage).toBe(0);
  });
});

describe('computeTokenBreakdown', () => {
  it('computes per-file breakdown', () => {
    const files = {
      'agent.md': 'a'.repeat(4000),    // 1000 tokens, limit 3000 → within
      'context.md': 'b'.repeat(8000),   // 2000 tokens, limit 5000 → within
    };
    const limits = { 'agent.md': 3000, 'context.md': 5000 };

    const result = computeTokenBreakdown(files, limits);
    expect(result.perFile['agent.md'].estimate).toBe(1000);
    expect(result.perFile['agent.md'].within).toBe(true);
    expect(result.perFile['context.md'].estimate).toBe(2000);
    expect(result.perFile['context.md'].within).toBe(true);
    expect(result.totalEstimate).toBe(3000);
    expect(result.totalWithin).toBe(true);
  });

  it('flags file exceeding per-file limit', () => {
    const files = {
      'agent.md': 'a'.repeat(20000),  // 5000 tokens, limit 3000 → OVER
    };
    const limits = { 'agent.md': 3000 };

    const result = computeTokenBreakdown(files, limits);
    expect(result.perFile['agent.md'].within).toBe(false);
    expect(result.perFile['agent.md'].estimate).toBe(5000);
  });

  it('only counts .md files toward total', () => {
    const files = {
      'agent.md': 'a'.repeat(400),         // 100 tokens
      'meta.json': 'b'.repeat(2000),       // 500 tokens — NOT counted
      'memory-keys.json': 'c'.repeat(400), // 100 tokens — NOT counted
    };
    const limits = { 'agent.md': 3000 };

    const result = computeTokenBreakdown(files, limits);
    expect(result.totalEstimate).toBe(100); // only agent.md
  });

  it('flags total exceeding controllable limit', () => {
    const files = {
      'agent.md': 'a'.repeat(40000),    // 10000 tokens
      'context.md': 'b'.repeat(40000),  // 10000 tokens
    };
    const limits = { 'agent.md': 15000, 'context.md': 15000 };

    const result = computeTokenBreakdown(files, limits);
    expect(result.totalEstimate).toBe(20000);
    expect(result.totalWithin).toBe(false);
  });

  it('handles empty files object', () => {
    const result = computeTokenBreakdown({}, {});
    expect(result.totalEstimate).toBe(0);
    expect(result.totalWithin).toBe(true);
    expect(Object.keys(result.perFile)).toHaveLength(0);
  });

  it('handles files with no defined limit', () => {
    const files = {
      'agent.md': 'a'.repeat(400),
      'unknown.md': 'b'.repeat(400),
    };
    const limits = { 'agent.md': 3000 };

    const result = computeTokenBreakdown(files, limits);
    expect(result.perFile['unknown.md'].limit).toBe(Infinity);
    expect(result.perFile['unknown.md'].within).toBe(true);
  });
});
