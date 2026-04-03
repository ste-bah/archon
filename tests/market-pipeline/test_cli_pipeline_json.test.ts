/**
 * TASK-MKT-003: Validate CLI JSON output includes pipeline config
 * Gate 1: tests-written-first
 *
 * These tests run the actual CLI and verify the JSON structure.
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

describe('CLI market-analysis JSON output', () => {
  describe('analyze sub-command (pipeline mode)', () => {
    let data: Record<string, unknown>;

    // Run CLI once for all tests in this block
    beforeAll(() => {
      data = runCli('ma analyze -t AAPL --json');
    }, 90000);

    it('should return success', () => {
      expect(data.success).toBe(true);
    });

    it('should set isPipeline to true', () => {
      expect(data.isPipeline).toBe(true);
    });

    it('should include pipeline in result', () => {
      const result = data.result as Record<string, unknown>;
      expect(result.pipeline).toBeDefined();
      expect(result.pipeline).not.toBeNull();
    });

    it('should have 4 phases in pipeline', () => {
      const result = data.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as unknown[];
      expect(phases).toHaveLength(4);
    });

    it('should have correct agent counts per phase', () => {
      const result = data.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      const phases = pipeline.phases as Array<{ agents: unknown[] }>;
      expect(phases[0].agents).toHaveLength(3);  // Data Collection
      expect(phases[1].agents).toHaveLength(6);  // Analysis
      expect(phases[2].agents).toHaveLength(1);  // Aggregation
      expect(phases[3].agents).toHaveLength(2);  // Output
    });

    it('should have correct data source priority', () => {
      const result = data.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      expect(pipeline.dataSourcePriority).toEqual([
        'market-terminal', 'perplexity', 'websearch'
      ]);
    });

    it('should have ticker set to AAPL', () => {
      const result = data.result as Record<string, unknown>;
      const pipeline = result.pipeline as Record<string, unknown>;
      expect(pipeline.ticker).toBe('AAPL');
    });

    it('should include feedbackCommand', () => {
      const result = data.result as Record<string, unknown>;
      expect(result.feedbackCommand).toBeDefined();
    });
  });

  describe('scan sub-command (non-pipeline mode)', () => {
    let data: Record<string, unknown>;

    beforeAll(() => {
      data = runCli('ma scan --signal bullish --json');
    }, 90000);

    it('should set isPipeline to false', () => {
      expect(data.isPipeline).toBe(false);
    });

    it('should have pipeline as null or undefined in result', () => {
      const result = data.result as Record<string, unknown>;
      expect(result.pipeline == null).toBe(true);
    });
  });
});
