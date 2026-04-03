/**
 * TASK-MKT-006: End-to-end integration tests for the market pipeline
 * Gate 1: tests-written-first
 *
 * Test 1: CLI pipeline JSON structure validation
 * Test 2: Pipeline agent prompts contain ticker substitution
 * Test 3: Scan/compare still work as single-agent (no regression)
 * Test 4: Pipeline config has correct memory key structure
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

function runCli(args: string): Record<string, unknown> {
  const output = execSync(
    `npx tsx src/god-agent/universal/cli.ts ${args}`,
    { encoding: 'utf-8', timeout: 60000, cwd: process.cwd() }
  );
  const jsonStr = output
    .split('__GODAGENT_JSON_START__')[1]
    ?.split('__GODAGENT_JSON_END__')[0];
  if (!jsonStr) throw new Error('No JSON sentinel found in CLI output');
  return JSON.parse(jsonStr);
}

describe('Market Pipeline Integration', () => {
  let pipelineData: Record<string, unknown>;

  beforeAll(() => {
    pipelineData = runCli('ma analyze -t AAPL --json');
  }, 90000);

  describe('Test 1: CLI Pipeline JSON structure', () => {
    it('should return isPipeline: true for analyze', () => {
      expect(pipelineData.isPipeline).toBe(true);
    });

    it('should have 4 phases with correct names', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ phase: number; name: string }>;
      expect(phases).toHaveLength(4);
      expect(phases[0].name).toBe('Data Collection');
      expect(phases[1].name).toBe('Methodology Analysis');
      expect(phases[2].name).toBe('Aggregation');
      expect(phases[3].name).toBe('Output');
    });

    it('should have 12 total agents', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ agents: unknown[] }>;
      const total = phases.reduce((sum, p) => sum + p.agents.length, 0);
      expect(total).toBe(12);
    });

    it('should have parallel=true for Phase 1 and Phase 2', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ parallel: boolean }>;
      expect(phases[0].parallel).toBe(true);
      expect(phases[1].parallel).toBe(true);
    });

    it('should have parallel=false for Phase 3 and Phase 4', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ parallel: boolean }>;
      expect(phases[2].parallel).toBe(false);
      expect(phases[3].parallel).toBe(false);
    });
  });

  describe('Test 2: Ticker substitution in agent prompts', () => {
    it('should have AAPL in all agent prompts (no {ticker} remaining)', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ agents: Array<{ key: string; prompt: string }> }>;
      for (const phase of phases) {
        for (const agent of phase.agents) {
          expect(agent.prompt).toContain('AAPL');
          expect(agent.prompt).not.toContain('{ticker}');
        }
      }
    });

    it('should normalize ticker to uppercase', () => {
      // CLI already uppercases, but the builder also does
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      expect(pipeline.ticker).toBe('AAPL');
    });
  });

  describe('Test 3: Non-pipeline modes (no regression)', () => {
    it('scan should return isPipeline: false', async () => {
      const data = runCli('ma scan --signal bullish --json');
      expect(data.isPipeline).toBe(false);
      const result = data.result as Record<string, unknown>;
      expect(result.pipeline).toBeNull();
    }, 90000);
  });

  describe('Test 4: Memory key structure', () => {
    it('Phase 1 agents should have memoryWrites with AAPL', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ agents: Array<{ memoryWrites: string[] }> }>;
      const phase1Writes = phases[0].agents.flatMap(a => a.memoryWrites);
      // At least some writes should contain AAPL
      const hasTickerWrites = phase1Writes.some(w => w.includes('AAPL'));
      expect(hasTickerWrites).toBe(true);
    });

    it('Phase 2 agents should have memoryReads', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ agents: Array<{ memoryReads: string[] }> }>;
      // At least some Phase 2 agents should read from memory
      const totalReads = phases[1].agents.reduce((sum, a) => sum + a.memoryReads.length, 0);
      expect(totalReads).toBeGreaterThan(0);
    });

    it('should have correct data source priority', () => {
      const result = pipelineData.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      expect(pipeline.dataSourcePriority).toEqual([
        'market-terminal', 'perplexity', 'websearch',
      ]);
    });
  });
});
