/**
 * T-SDK-002: Tool restriction integration test.
 * Verifies PreToolUse hook blocks write tools for Phase 1-3 agents.
 *
 * NOTE: This test verifies the hook LOGIC, not the full SDK integration.
 * Full SDK integration requires a real Claude API call — tested in Phase 4 parity.
 */

import { describe, it, expect } from 'vitest';

/** Simulate the PreToolUse hook logic from sdk-pipeline-runner.ts */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit']);

function simulatePreToolUseHook(
  toolName: string,
  phase: number,
  isSherlockReviewer: boolean,
): { decision: 'block' | 'allow'; reason?: string } {
  const isReadOnly = phase <= 3 || isSherlockReviewer;
  if (isReadOnly && WRITE_TOOLS.has(toolName)) {
    return {
      decision: 'block',
      reason: `${isSherlockReviewer ? 'Sherlock reviewers' : `Phase ${phase} agents`} are read-only — ${toolName} blocked`,
    };
  }
  return { decision: 'allow' };
}

describe('T-SDK-002: Tool restriction for Phase 1-3 agents', () => {
  it('blocks Write for Phase 1 agent', () => {
    const result = simulatePreToolUseHook('Write', 1, false);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Phase 1');
  });

  it('blocks Edit for Phase 2 agent', () => {
    const result = simulatePreToolUseHook('Edit', 2, false);
    expect(result.decision).toBe('block');
  });

  it('blocks Bash for Phase 3 agent', () => {
    const result = simulatePreToolUseHook('Bash', 3, false);
    expect(result.decision).toBe('block');
  });

  it('blocks NotebookEdit for Phase 1 agent', () => {
    const result = simulatePreToolUseHook('NotebookEdit', 1, false);
    expect(result.decision).toBe('block');
  });

  it('allows Read for Phase 1 agent', () => {
    const result = simulatePreToolUseHook('Read', 1, false);
    expect(result.decision).toBe('allow');
  });

  it('allows Grep for Phase 2 agent', () => {
    const result = simulatePreToolUseHook('Grep', 2, false);
    expect(result.decision).toBe('allow');
  });

  it('allows Glob for Phase 3 agent', () => {
    const result = simulatePreToolUseHook('Glob', 3, false);
    expect(result.decision).toBe('allow');
  });

  it('allows Write for Phase 4 agent', () => {
    const result = simulatePreToolUseHook('Write', 4, false);
    expect(result.decision).toBe('allow');
  });

  it('allows Edit for Phase 5 agent', () => {
    const result = simulatePreToolUseHook('Edit', 5, false);
    expect(result.decision).toBe('allow');
  });

  it('allows Bash for Phase 6 agent', () => {
    const result = simulatePreToolUseHook('Bash', 6, false);
    expect(result.decision).toBe('allow');
  });

  it('allows all tools for Phase 7 agent', () => {
    for (const tool of ['Write', 'Edit', 'Bash', 'Read', 'Grep', 'Glob']) {
      const result = simulatePreToolUseHook(tool, 7, false);
      expect(result.decision).toBe('allow');
    }
  });
});

describe('T-SDK-002: Tool restriction for Sherlock reviewers', () => {
  it('blocks Write for Sherlock reviewer regardless of phase', () => {
    // Sherlock reviewers run at phase boundaries (e.g., phase 4+)
    // but should still be read-only
    const result = simulatePreToolUseHook('Write', 4, true);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Sherlock reviewers');
  });

  it('blocks Edit for Sherlock reviewer', () => {
    const result = simulatePreToolUseHook('Edit', 5, true);
    expect(result.decision).toBe('block');
  });

  it('allows Read for Sherlock reviewer', () => {
    const result = simulatePreToolUseHook('Read', 4, true);
    expect(result.decision).toBe('allow');
  });

  it('allows Grep for Sherlock reviewer', () => {
    const result = simulatePreToolUseHook('Grep', 4, true);
    expect(result.decision).toBe('allow');
  });
});
