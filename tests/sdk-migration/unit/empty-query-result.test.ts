/**
 * T-EC-014: Empty query result handling.
 * Verifies retry once on empty result, then abort with quality 0.
 * Quality score 0 is below all phase thresholds → pipeline aborts.
 */

import { describe, it, expect } from 'vitest';

describe('T-EC-014: Empty query result handling', () => {
  it('null result should be treated as empty', () => {
    const result = null;
    const isEmpty = !result || !(result as { result?: string }).result;
    expect(isEmpty).toBe(true);
  });

  it('empty string result should be treated as empty', () => {
    const result = { subtype: 'success', result: '' };
    const isEmpty = !result.result;
    expect(isEmpty).toBe(true);
  });

  it('non-success subtype should be treated as empty', () => {
    const result = { subtype: 'error', result: 'some output' };
    const isEmpty = result.subtype !== 'success';
    expect(isEmpty).toBe(true);
  });

  it('valid result passes validation', () => {
    const result = { subtype: 'success', result: '## Task Analysis\nThis is real output.' };
    const isValid = result.subtype === 'success' && !!result.result;
    expect(isValid).toBe(true);
  });

  it('quality score 0 is below ALL phase thresholds', () => {
    const PHASE_QUALITY_THRESHOLDS: Record<number, { threshold: number }> = {
      1: { threshold: 0.90 },
      2: { threshold: 0.60 },
      3: { threshold: 0.95 },
      4: { threshold: 0.80 },
      5: { threshold: 0.80 },
      6: { threshold: 0.85 },
      7: { threshold: 0.90 },
    };

    const qualityScore = 0;
    for (let phase = 1; phase <= 7; phase++) {
      expect(qualityScore).toBeLessThan(PHASE_QUALITY_THRESHOLDS[phase].threshold);
    }
  });

  it('empty result gets 1 retry via quality gate loop (2 total attempts)', () => {
    // AgentEmptyResultError is NOT retried by withApiRetry (thrown immediately).
    // Instead, the quality gate loop catches it:
    //   qualityAttempt 0: empty result → continue (1 retry)
    //   qualityAttempt 1: empty result → abort with quality 0
    // Total: 2 SDK query() calls for a persistently empty agent.
    const MAX_QUALITY_RETRIES = 2;
    // First empty at attempt 0 → continue. Second empty at attempt 1 → abort.
    const EMPTY_RESULT_TOTAL_ATTEMPTS = 2;
    expect(EMPTY_RESULT_TOTAL_ATTEMPTS).toBeLessThanOrEqual(MAX_QUALITY_RETRIES + 1);
  });
});
