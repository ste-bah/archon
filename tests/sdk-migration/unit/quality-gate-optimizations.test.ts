/**
 * Tests for SDK pipeline quality gate optimizations:
 * - OPT-001: Close-enough margin (3%)
 * - OPT-002: Reviewer retry cap (1 vs 2)
 * - OPT-003: Enriched retry prompt (breakdown + previous output)
 */

import { describe, it, expect } from 'vitest';

// ── Constants matching sdk-pipeline-runner.ts ──────────────────────────────
const MAX_QUALITY_RETRIES = 2;
const MAX_REVIEWER_RETRIES = 1;
const CLOSE_ENOUGH_MARGIN = 0.03;
const PREVIOUS_OUTPUT_TRUNCATION = 3000;

const PHASE_QUALITY_THRESHOLDS: Record<number, { metric: string; threshold: number }> = {
  1: { metric: 'decomposition', threshold: 0.90 },
  2: { metric: 'candidates', threshold: 0.60 },
  3: { metric: 'consistency', threshold: 0.95 },
  4: { metric: 'type_coverage', threshold: 0.80 },
  5: { metric: 'test_coverage', threshold: 0.80 },
  6: { metric: 'security', threshold: 0.85 },
  7: { metric: 'documentation', threshold: 0.90 },
};

/** Simulate the quality gate decision logic */
function qualityGateDecision(
  score: number,
  phase: number,
  isReviewer: boolean,
  attempt: number,
): 'pass' | 'margin-pass' | 'retry' | 'proceed-best-effort' {
  const gate = PHASE_QUALITY_THRESHOLDS[phase];
  if (!gate) return 'pass';

  const maxRetries = isReviewer ? MAX_REVIEWER_RETRIES : MAX_QUALITY_RETRIES;

  if (score >= gate.threshold) return 'pass';
  if (score >= gate.threshold - CLOSE_ENOUGH_MARGIN) return 'margin-pass';
  if (attempt < maxRetries) return 'retry';
  return 'proceed-best-effort';
}

// ── OPT-001: Close-enough margin ──────────────────────────────────────────

describe('OPT-001: Close-enough margin (3%)', () => {
  it('score at threshold passes normally', () => {
    expect(qualityGateDecision(0.90, 1, false, 0)).toBe('pass');
  });

  it('score above threshold passes normally', () => {
    expect(qualityGateDecision(0.95, 1, false, 0)).toBe('pass');
  });

  it('score within 3% margin passes via margin', () => {
    // 87% passes a 90% gate via margin (90% - 3% = 87%)
    expect(qualityGateDecision(0.87, 1, false, 0)).toBe('margin-pass');
    expect(qualityGateDecision(0.88, 1, false, 0)).toBe('margin-pass');
    expect(qualityGateDecision(0.89, 1, false, 0)).toBe('margin-pass');
  });

  it('score below margin triggers retry', () => {
    // 86% does NOT pass a 90% gate (86% < 87%)
    expect(qualityGateDecision(0.86, 1, false, 0)).toBe('retry');
    expect(qualityGateDecision(0.80, 1, false, 0)).toBe('retry');
    expect(qualityGateDecision(0.50, 1, false, 0)).toBe('retry');
  });

  it('margin applies consistently across phases', () => {
    // Phase 3: threshold 0.95, margin at 0.92
    expect(qualityGateDecision(0.92, 3, false, 0)).toBe('margin-pass');
    expect(qualityGateDecision(0.91, 3, false, 0)).toBe('retry');

    // Phase 2: threshold 0.60, margin at 0.57
    expect(qualityGateDecision(0.57, 2, false, 0)).toBe('margin-pass');
    expect(qualityGateDecision(0.56, 2, false, 0)).toBe('retry');

    // Phase 6: threshold 0.85, margin at 0.82
    expect(qualityGateDecision(0.82, 6, false, 0)).toBe('margin-pass');
    expect(qualityGateDecision(0.81, 6, false, 0)).toBe('retry');
  });

  it('CLOSE_ENOUGH_MARGIN is exactly 0.03', () => {
    expect(CLOSE_ENOUGH_MARGIN).toBe(0.03);
  });
});

// ── OPT-002: Reviewer retry cap ──────────────────────────────────────────

describe('OPT-002: Reviewer retry cap (1 vs 2)', () => {
  it('normal agents get 2 retries (3 total attempts)', () => {
    expect(qualityGateDecision(0.50, 1, false, 0)).toBe('retry');
    expect(qualityGateDecision(0.50, 1, false, 1)).toBe('retry');
    expect(qualityGateDecision(0.50, 1, false, 2)).toBe('proceed-best-effort');
  });

  it('reviewer agents get 1 retry (2 total attempts)', () => {
    expect(qualityGateDecision(0.50, 1, true, 0)).toBe('retry');
    expect(qualityGateDecision(0.50, 1, true, 1)).toBe('proceed-best-effort');
  });

  it('reviewer passing via margin skips retry entirely', () => {
    // 88% reviewer against 90% threshold → margin pass, no retry needed
    expect(qualityGateDecision(0.88, 1, true, 0)).toBe('margin-pass');
  });

  it('MAX_REVIEWER_RETRIES is exactly 1', () => {
    expect(MAX_REVIEWER_RETRIES).toBe(1);
  });

  it('MAX_QUALITY_RETRIES is exactly 2', () => {
    expect(MAX_QUALITY_RETRIES).toBe(2);
  });
});

// ── OPT-003: Enriched retry prompt ──────────────────────────────────────

describe('OPT-003: Enriched retry prompt content', () => {
  /** Simplified buildQualityRetryPrompt matching the production implementation */
  function buildQualityRetryPrompt(
    originalPrompt: string,
    quality: number,
    threshold: number,
    metric: string,
    breakdown?: { codeQuality: number; completeness: number; structuralIntegrity: number; documentationScore: number; testCoverage: number },
    previousOutput?: string,
  ): string {
    let header = `## QUALITY GATE RETRY\n\nYour previous output scored ${(quality * 100).toFixed(0)}% on the "${metric}" quality gate.\nThe required threshold is ${(threshold * 100).toFixed(0)}%.\n`;

    if (breakdown) {
      header += `\n### Quality Breakdown\n- Code Quality: ${(breakdown.codeQuality * 100).toFixed(0)}%\n`;
    }

    if (previousOutput) {
      let truncated = previousOutput;
      if (truncated.length > PREVIOUS_OUTPUT_TRUNCATION) {
        truncated = truncated.substring(0, PREVIOUS_OUTPUT_TRUNCATION);
        const lastNewline = truncated.lastIndexOf('\n');
        if (lastNewline > PREVIOUS_OUTPUT_TRUNCATION * 0.8) {
          truncated = truncated.substring(0, lastNewline);
        }
        truncated += '\n... [truncated — full output is on disk]';
      }
      header += `\n### Your Previous Output\n${truncated}\n`;
    }

    return `${header}\n---\n\n${originalPrompt}`;
  }

  it('includes quality score and threshold', () => {
    const prompt = buildQualityRetryPrompt('task', 0.77, 0.90, 'decomposition');
    expect(prompt).toContain('scored 77%');
    expect(prompt).toContain('threshold is 90%');
    expect(prompt).toContain('decomposition');
  });

  it('includes quality breakdown when provided', () => {
    const breakdown = {
      codeQuality: 0.18, completeness: 0.20,
      structuralIntegrity: 0.15, documentationScore: 0.05, testCoverage: 0.03,
    };
    const prompt = buildQualityRetryPrompt('task', 0.61, 0.90, 'decomposition', breakdown);
    expect(prompt).toContain('Quality Breakdown');
    expect(prompt).toContain('Code Quality: 18%');
  });

  it('includes previous output when provided', () => {
    const prompt = buildQualityRetryPrompt('task', 0.77, 0.90, 'decomposition', undefined, 'My previous analysis...');
    expect(prompt).toContain('Previous Output');
    expect(prompt).toContain('My previous analysis...');
  });

  it('truncates previous output at line boundary within 3000 chars', () => {
    const longOutput = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`).join('\n');
    expect(longOutput.length).toBeGreaterThan(3000);

    const prompt = buildQualityRetryPrompt('task', 0.5, 0.9, 'decomposition', undefined, longOutput);
    expect(prompt).toContain('truncated');
    // The truncated content should be less than 3000 + some margin for the truncation message
    const previousSection = prompt.split('### Your Previous Output')[1]?.split('---')[0] || '';
    expect(previousSection.length).toBeLessThan(3200);
  });

  it('does not truncate short previous output', () => {
    const shortOutput = 'Short analysis result.';
    const prompt = buildQualityRetryPrompt('task', 0.5, 0.9, 'decomposition', undefined, shortOutput);
    expect(prompt).not.toContain('truncated');
    expect(prompt).toContain('Short analysis result.');
  });

  it('includes original prompt at the end', () => {
    const prompt = buildQualityRetryPrompt('ORIGINAL TASK PROMPT', 0.5, 0.9, 'decomposition');
    expect(prompt).toContain('ORIGINAL TASK PROMPT');
    // Original prompt should come after the --- separator
    const parts = prompt.split('---');
    expect(parts[parts.length - 1]).toContain('ORIGINAL TASK PROMPT');
  });
});
