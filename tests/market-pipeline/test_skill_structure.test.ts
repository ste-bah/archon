/**
 * TASK-MKT-004: Validate skill file structure for pipeline orchestration
 * Gate 1: tests-written-first
 *
 * The skill file is declarative markdown, so we validate its structure
 * rather than executing it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILL_DIR = join(__dirname, '../../.claude/skills/god-market-analysis');

describe('god-market-analysis skill file', () => {
  let content: string;

  beforeAll(() => {
    content = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8');
  });

  it('should exist', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('should reference isPipeline detection', () => {
    expect(content).toMatch(/isPipeline.*true|pipeline.*detected/i);
  });

  it('should reference all 4 phases', () => {
    expect(content).toMatch(/Phase 1|Data Collection/i);
    expect(content).toMatch(/Phase 2|Methodology Analysis|Analysis/i);
    expect(content).toMatch(/Phase 3|Aggregation/i);
    expect(content).toMatch(/Phase 4|Output/i);
  });

  it('should mention parallel execution for Phase 1', () => {
    expect(content).toMatch(/parallel|simultaneous/i);
  });

  it('should mention sequential execution for Phase 3 or 4', () => {
    expect(content).toMatch(/sequential|wait.*complet/i);
  });

  it('should reference all 12 agent keys', () => {
    const agentKeys = [
      'data-fetcher', 'fundamentals-fetcher', 'news-macro-fetcher',
      'wyckoff-analyzer', 'elliott-wave-analyzer', 'ict-analyzer',
      'canslim-analyzer', 'williams-analyzer', 'sentiment-analyzer',
      'composite-scorer', 'thesis-generator', 'report-formatter',
    ];
    for (const key of agentKeys) {
      expect(content).toContain(key);
    }
  });

  it('should reference Agent() tool for spawning', () => {
    expect(content).toMatch(/Agent\(|Agent tool/);
  });

  it('should reference feedback submission', () => {
    expect(content).toMatch(/feedback|feedbackCommand/i);
  });

  it('should handle fallback to single-agent mode', () => {
    expect(content).toMatch(/isPipeline.*false|single.agent|fallback/i);
  });

  it('should reference error handling for failed agents', () => {
    expect(content).toMatch(/fail|error|warning|graceful/i);
  });
});
