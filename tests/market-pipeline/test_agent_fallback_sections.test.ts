/**
 * TASK-MKT-005: Validate all 12 market-pipeline agents have Data Source Priority sections
 * Gate 1: tests-written-first
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PIPELINE_DIR = join(__dirname, '../../.claude/agents/market-pipeline');

const EXPECTED_AGENTS = [
  'data-fetcher',
  'fundamentals-fetcher',
  'news-macro-fetcher',
  'wyckoff-analyzer',
  'elliott-wave-analyzer',
  'ict-analyzer',
  'canslim-analyzer',
  'williams-analyzer',
  'sentiment-analyzer',
  'composite-scorer',
  'thesis-generator',
  'report-formatter',
];

const PHASE_1_AGENTS = ['data-fetcher', 'fundamentals-fetcher', 'news-macro-fetcher'];
const PHASE_2_AGENTS = ['wyckoff-analyzer', 'elliott-wave-analyzer', 'ict-analyzer', 'canslim-analyzer', 'williams-analyzer', 'sentiment-analyzer'];
const PHASE_3_4_AGENTS = ['composite-scorer', 'thesis-generator', 'report-formatter'];

describe('Market Pipeline Agent Fallback Sections', () => {
  it('should have all 12 agent files', () => {
    const files = readdirSync(PIPELINE_DIR).filter(f => f.endsWith('.md'));
    expect(files).toHaveLength(12);
  });

  for (const agentName of EXPECTED_AGENTS) {
    describe(agentName, () => {
      let content: string;

      try {
        content = readFileSync(join(PIPELINE_DIR, `${agentName}.md`), 'utf-8');
      } catch {
        content = '';
      }

      it('should have a Data Source Priority section', () => {
        expect(content).toContain('## Data Source Priority');
      });

      it('should mention all three data sources in priority order', () => {
        // Phase 3-4 agents use label form "MCP Market Terminal", Phase 1-2 use tool form "market-terminal"
        expect(content).toMatch(/market.terminal|Market Terminal/i);
        expect(content).toMatch(/perplexity|Perplexity/);
        expect(content).toContain('WebSearch');
      });

      it('should have valid YAML frontmatter', () => {
        expect(content.startsWith('---')).toBe(true);
        const closingIndex = content.indexOf('---', 3);
        expect(closingIndex).toBeGreaterThan(3);
      });

      if (PHASE_1_AGENTS.includes(agentName)) {
        it('should have perplexity fallback queries for Phase 1 data fetcher', () => {
          expect(content).toContain('perplexity_search');
        });
      }

      if (PHASE_2_AGENTS.includes(agentName)) {
        it('should have instructions for missing memory data fallback', () => {
          expect(content).toMatch(/memory.*empty|memory.*missing|data.*unavailable|fetch.*directly/i);
        });
      }

      if (PHASE_3_4_AGENTS.includes(agentName)) {
        it('should explicitly state no data fetching', () => {
          expect(content).toMatch(/no.*data.*fetch|pure.*synthesis|do not fetch|not.*fetch.*data/i);
        });
      }
    });
  }
});
