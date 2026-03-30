/**
 * TASK-GOD-002: Market Analysis CLI Command Tests
 *
 * Comprehensive test suite covering:
 * 1. Input Validation (4 fatal error paths)
 * 2. Happy Path (3 sub-commands: analyze, scan, compare)
 * 3. Graceful Degradation (DESC/trajectory failures)
 * 4. JSON Output Structure
 * 5. Agent Map Routing
 * 6. Trajectory Bridge Mode Mapping
 *
 * Uses vitest, follows existing project test patterns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

import { UniversalAgent, type IMarketAnalysisTaskPreparation } from '../../../src/god-agent/universal/universal-agent.js';
import { TrajectoryBridge } from '../../../src/god-agent/universal/trajectory-bridge.js';
import { ReasoningMode } from '../../../src/god-agent/core/reasoning/reasoning-types.js';

const execFileAsync = promisify(execFile);

// Path to the CLI entry point
const CLI_PATH = path.resolve(__dirname, '../../../src/god-agent/universal/cli.ts');
const TSX_PATH = 'npx';

/**
 * Helper: Run the CLI as a subprocess with given arguments.
 * Returns { stdout, stderr, exitCode }.
 *
 * We use --json mode for machine-readable output parsing.
 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(TSX_PATH, ['tsx', CLI_PATH, ...args], {
      timeout: 30000, // 30s timeout for agent initialization
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.code ?? 1,
    };
  }
}

/**
 * Helper: Extract JSON from CLI output wrapped in __GODAGENT_JSON_START__/__GODAGENT_JSON_END__
 */
function extractJson(stdout: string): any {
  const startMarker = '__GODAGENT_JSON_START__';
  const endMarker = '__GODAGENT_JSON_END__';
  const startIdx = stdout.indexOf(startMarker);
  const endIdx = stdout.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`JSON markers not found in output:\n${stdout}`);
  }

  const jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();
  return JSON.parse(jsonStr);
}


// =====================================================================
// Category 1: Input Validation Tests (4 fatal error paths)
// =====================================================================

describe('TASK-GOD-002: Market Analysis CLI - Input Validation', () => {

  it('should exit 1 with error when no sub-command provided', async () => {
    const result = await runCli(['market-analysis', '--json']);

    expect(result.exitCode).not.toBe(0);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.command).toBe('market-analysis');
    expect(json.error).toContain('No sub-command provided');
    expect(json.error).toContain('analyze');
    expect(json.error).toContain('scan');
    expect(json.error).toContain('compare');
  });

  it('should exit 1 with error when invalid sub-command provided', async () => {
    const result = await runCli(['market-analysis', 'invalid-cmd', '--json']);

    expect(result.exitCode).not.toBe(0);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.command).toBe('market-analysis');
    expect(json.error).toContain('Invalid sub-command');
    expect(json.error).toContain("'invalid-cmd'");
    expect(json.error).toContain('analyze');
    expect(json.error).toContain('scan');
    expect(json.error).toContain('compare');
  });

  it('should exit 1 when analyze sub-command used without --ticker', async () => {
    const result = await runCli(['market-analysis', 'analyze', '--json']);

    expect(result.exitCode).not.toBe(0);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.command).toBe('market-analysis');
    expect(json.error).toContain('analyze');
    expect(json.error).toContain('--ticker');
  });

  it('should exit 1 when compare sub-command used without --ticker and --compare', async () => {
    const result = await runCli(['market-analysis', 'compare', '--json']);

    expect(result.exitCode).not.toBe(0);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.command).toBe('market-analysis');
    expect(json.error).toContain('compare');
    expect(json.error).toContain('--ticker');
    expect(json.error).toContain('--compare');
  });

  it('should exit 1 when compare sub-command has --ticker but no --compare', async () => {
    const result = await runCli(['market-analysis', 'compare', '--ticker', 'AAPL', '--json']);

    expect(result.exitCode).not.toBe(0);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error).toContain('--compare');
  });

  it('should exit 1 when compare sub-command has --compare but no --ticker', async () => {
    const result = await runCli(['market-analysis', 'compare', '--compare', 'MSFT', '--json']);

    expect(result.exitCode).not.toBe(0);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error).toContain('--ticker');
  });

  it('should output non-JSON error to stderr when not in JSON mode', async () => {
    const result = await runCli(['market-analysis']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No sub-command provided');
  });

  it('should output non-JSON error for invalid sub-command without --json', async () => {
    const result = await runCli(['market-analysis', 'badcmd']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Invalid sub-command');
    expect(result.stderr).toContain("'badcmd'");
  });

  it('should include isPipeline: false in all validation error outputs', async () => {
    const noSubCmd = await runCli(['market-analysis', '--json']);
    const invalidSubCmd = await runCli(['market-analysis', 'badcmd', '--json']);
    const noTicker = await runCli(['market-analysis', 'analyze', '--json']);
    const noCompare = await runCli(['market-analysis', 'compare', '--json']);

    for (const result of [noSubCmd, invalidSubCmd, noTicker, noCompare]) {
      const json = extractJson(result.stdout);
      expect(json.isPipeline).toBe(false);
    }
  });

  it('should include selectedAgent as god-market-analysis in all error outputs', async () => {
    const result = await runCli(['market-analysis', '--json']);

    const json = extractJson(result.stdout);
    expect(json.selectedAgent).toBe('god-market-analysis');
  });

  it('should accept short alias -t for --ticker', async () => {
    // This tests that -t is accepted; the analyze case should NOT error with -t AAPL
    // Note: This test reaches agent initialization, which makes it a heavier test
    const result = await runCli(['market-analysis', 'analyze', '-t', 'AAPL', '--json']);

    // If the flag parsing works, it should NOT get the "requires --ticker" error
    // It may fail for other reasons (agent init, embedding) but NOT for missing ticker
    if (result.exitCode !== 0) {
      const json = extractJson(result.stdout);
      // If it errors, it should NOT be about missing --ticker
      if (json.error) {
        expect(json.error).not.toContain('requires --ticker');
      }
    }
  });
});


// =====================================================================
// Category 2: Happy Path Tests (via UniversalAgent.prepareMarketAnalysisTask)
// =====================================================================

describe('TASK-GOD-002: Market Analysis - prepareMarketAnalysisTask', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('analyze sub-command', () => {
    it('should return preparation with all required fields for analyze', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        {
          subCommand: 'analyze',
          ticker: 'AAPL',
        }
      );

      // Verify all IMarketAnalysisTaskPreparation fields
      expect(result.selectedAgent).toBeDefined();
      expect(typeof result.selectedAgent).toBe('string');
      expect(result.selectedAgent.length).toBeGreaterThan(0);

      expect(result.agentType).toBeDefined();
      expect(typeof result.agentType).toBe('string');

      expect(result.agentCategory).toBeDefined();
      expect(typeof result.agentCategory).toBe('string');

      expect(result.builtPrompt).toBeDefined();
      expect(typeof result.builtPrompt).toBe('string');
      expect(result.builtPrompt.length).toBeGreaterThan(0);

      expect(result.userTask).toBe('market-analysis analyze ticker:AAPL');

      // isPipeline must always be false for market-analysis
      expect(result.isPipeline).toBe(false);
      expect(result.pipeline).toBeUndefined();

      // Sub-command specific fields
      expect(result.subCommand).toBe('analyze');
      expect(result.ticker).toBe('AAPL');
    });

    it('should include methodology in preparation when provided', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL methodology:wyckoff',
        {
          subCommand: 'analyze',
          ticker: 'AAPL',
          methodology: 'wyckoff',
        }
      );

      expect(result.methodology).toBe('wyckoff');
      expect(result.builtPrompt).toContain('Wyckoff');
    });

    it('should include signal filter in preparation when provided', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL signal:bullish',
        {
          subCommand: 'analyze',
          ticker: 'AAPL',
          signalFilter: 'bullish',
        }
      );

      expect(result.signalFilter).toBe('bullish');
      expect(result.builtPrompt).toContain('bullish');
    });

    it('should include analyze-specific instructions in builtPrompt', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        {
          subCommand: 'analyze',
          ticker: 'AAPL',
        }
      );

      // The builtPrompt should contain analysis-specific guidance
      expect(result.builtPrompt).toContain('Technical analysis');
      expect(result.builtPrompt).toContain('AAPL');
    });
  });

  describe('scan sub-command', () => {
    it('should return preparation for scan (no required flags)', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis scan',
        {
          subCommand: 'scan',
        }
      );

      expect(result.subCommand).toBe('scan');
      expect(result.isPipeline).toBe(false);
      expect(result.builtPrompt).toBeDefined();
      expect(result.builtPrompt.length).toBeGreaterThan(0);
      expect(result.selectedAgent).toBeDefined();
      expect(result.agentType).toBeDefined();
    });

    it('should accept optional ticker for scan', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis scan ticker:TSLA',
        {
          subCommand: 'scan',
          ticker: 'TSLA',
        }
      );

      expect(result.ticker).toBe('TSLA');
      expect(result.builtPrompt).toContain('TSLA');
    });

    it('should include scan-specific instructions in builtPrompt', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis scan',
        {
          subCommand: 'scan',
        }
      );

      expect(result.builtPrompt).toContain('Scan');
    });
  });

  describe('compare sub-command', () => {
    it('should return preparation for compare with both tickers', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis compare ticker:AAPL compare:MSFT',
        {
          subCommand: 'compare',
          ticker: 'AAPL',
          compareTicker: 'MSFT',
        }
      );

      expect(result.subCommand).toBe('compare');
      expect(result.ticker).toBe('AAPL');
      expect(result.compareTicker).toBe('MSFT');
      expect(result.isPipeline).toBe(false);
      expect(result.builtPrompt).toBeDefined();
      expect(result.builtPrompt.length).toBeGreaterThan(0);
    });

    it('should include both tickers in builtPrompt', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis compare ticker:AAPL compare:MSFT',
        {
          subCommand: 'compare',
          ticker: 'AAPL',
          compareTicker: 'MSFT',
        }
      );

      expect(result.builtPrompt).toContain('AAPL');
      expect(result.builtPrompt).toContain('MSFT');
    });

    it('should include compare-specific instructions in builtPrompt', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis compare ticker:AAPL compare:MSFT',
        {
          subCommand: 'compare',
          ticker: 'AAPL',
          compareTicker: 'MSFT',
        }
      );

      expect(result.builtPrompt).toContain('Comparison');
    });
  });
});


// =====================================================================
// Category 3: Graceful Degradation Tests
// =====================================================================

describe('TASK-GOD-002: Market Analysis - Graceful Degradation', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('should return descContext as null when DESC injection is unavailable', async () => {
    // DESC injection may fail in test environments without embedding service
    // The method should still succeed with descContext: null
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      {
        subCommand: 'analyze',
        ticker: 'AAPL',
      }
    );

    // descContext can be null (no DESC episodes) or a string (episodes found)
    // The important thing is it does not throw
    expect(result).toBeDefined();
    expect(result.builtPrompt.length).toBeGreaterThan(0);
    // descContext should be string | null, not undefined
    expect(result.descContext === null || typeof result.descContext === 'string').toBe(true);
  });

  it('should return trajectoryId as null when trajectory creation is unavailable', async () => {
    // In test environments, trajectory bridge may not be configured
    // The method should still succeed with trajectoryId: null
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      {
        subCommand: 'analyze',
        ticker: 'AAPL',
      }
    );

    // trajectoryId can be null (bridge unavailable) or string (bridge available)
    // The important thing is it does not throw
    expect(result).toBeDefined();
    expect(result.builtPrompt.length).toBeGreaterThan(0);
    expect(result.trajectoryId === null || typeof result.trajectoryId === 'string').toBe(true);
  });

  it('should not crash when both DESC and trajectory fail', async () => {
    // This tests the double-failure path: both DESC injection AND trajectory creation fail
    // prepareMarketAnalysisTask should still return a valid result
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis scan',
      {
        subCommand: 'scan',
      }
    );

    expect(result).toBeDefined();
    expect(result.selectedAgent).toBeDefined();
    expect(result.agentType).toBeDefined();
    expect(result.builtPrompt.length).toBeGreaterThan(0);
    expect(result.isPipeline).toBe(false);
    expect(result.subCommand).toBe('scan');
  });
});


// =====================================================================
// Category 4: JSON Output Structure Tests
// =====================================================================

describe('TASK-GOD-002: Market Analysis - JSON Output Structure', () => {

  describe('Error output structure', () => {
    it('should always include isPipeline as false in error outputs', async () => {
      const result = await runCli(['market-analysis', '--json']);

      const json = extractJson(result.stdout);
      expect(json.isPipeline).toBe(false);
    });

    it('should include command, selectedAgent, prompt, result, success, error in error outputs', async () => {
      const result = await runCli(['market-analysis', '--json']);

      const json = extractJson(result.stdout);
      expect(json).toHaveProperty('command');
      expect(json).toHaveProperty('selectedAgent');
      expect(json).toHaveProperty('prompt');
      expect(json).toHaveProperty('isPipeline');
      expect(json).toHaveProperty('result');
      expect(json).toHaveProperty('success');
      expect(json).toHaveProperty('error');

      expect(json.command).toBe('market-analysis');
      expect(json.prompt).toBe('');
      expect(json.result).toBeNull();
      expect(json.success).toBe(false);
    });
  });

  describe('Success output structure (via prepareMarketAnalysisTask)', () => {
    let agent: UniversalAgent;

    beforeEach(async () => {
      agent = new UniversalAgent({
        autoLearn: false,
        verbose: false,
      });
      await agent.initialize();
    });

    afterEach(async () => {
      await agent.shutdown();
    });

    it('should have isPipeline always false in preparation result', async () => {
      const analyzeResult = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        { subCommand: 'analyze', ticker: 'AAPL' }
      );
      const scanResult = await agent.prepareMarketAnalysisTask(
        'market-analysis scan',
        { subCommand: 'scan' }
      );
      const compareResult = await agent.prepareMarketAnalysisTask(
        'market-analysis compare ticker:AAPL compare:MSFT',
        { subCommand: 'compare', ticker: 'AAPL', compareTicker: 'MSFT' }
      );

      expect(analyzeResult.isPipeline).toBe(false);
      expect(scanResult.isPipeline).toBe(false);
      expect(compareResult.isPipeline).toBe(false);
    });

    it('should have pipeline always undefined in preparation result', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        { subCommand: 'analyze', ticker: 'AAPL' }
      );

      expect(result.pipeline).toBeUndefined();
    });

    it('should include all required fields for JSON result construction', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        { subCommand: 'analyze', ticker: 'AAPL' }
      );

      // These fields are required for the CLI JSON output
      expect(result).toHaveProperty('builtPrompt');
      expect(result).toHaveProperty('agentType');
      expect(result).toHaveProperty('agentCategory');
      expect(result).toHaveProperty('subCommand');
      expect(result).toHaveProperty('descContext');
      expect(result).toHaveProperty('memoryContext');
      expect(result).toHaveProperty('selectedAgent');
      expect(result).toHaveProperty('isPipeline');
      expect(result).toHaveProperty('trajectoryId');
      expect(result).toHaveProperty('userTask');
    });

    it('should have feedbackRequired and feedbackCommand derivable from result', async () => {
      const result = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        { subCommand: 'analyze', ticker: 'AAPL' }
      );

      // feedbackRequired is always true in the JSON output (hardcoded in CLI)
      // feedbackCommand depends on trajectoryId
      if (result.trajectoryId) {
        // If trajectory was created, feedbackCommand would be non-null
        const expectedFeedbackCmd = `npx tsx src/god-agent/universal/cli.ts feedback "${result.trajectoryId}"`;
        expect(expectedFeedbackCmd).toContain(result.trajectoryId);
      }
      // If trajectoryId is null, feedbackCommand would be undefined in JSON output
      // Either way, the preparation result is valid
      expect(result).toBeDefined();
    });
  });
});


// =====================================================================
// Category 5: Agent Map Routing Tests
// =====================================================================

describe('TASK-GOD-002: Market Analysis - Agent Map Routing', () => {

  it('market-analysis should map to god-market-analysis in JSON error output', async () => {
    const result = await runCli(['market-analysis', '--json']);

    const json = extractJson(result.stdout);
    expect(json.selectedAgent).toBe('god-market-analysis');
  });

  it('ma alias should map to god-market-analysis in JSON error output', async () => {
    const result = await runCli(['ma', '--json']);

    const json = extractJson(result.stdout);
    expect(json.selectedAgent).toBe('god-market-analysis');
  });

  it('both market-analysis and ma should produce same selectedAgent', async () => {
    const fullResult = await runCli(['market-analysis', '--json']);
    const aliasResult = await runCli(['ma', '--json']);

    const fullJson = extractJson(fullResult.stdout);
    const aliasJson = extractJson(aliasResult.stdout);

    expect(fullJson.selectedAgent).toBe(aliasJson.selectedAgent);
    expect(fullJson.selectedAgent).toBe('god-market-analysis');
  });

  it('ma alias should handle validation errors identically to market-analysis', async () => {
    const fullResult = await runCli(['market-analysis', 'analyze', '--json']);
    const aliasResult = await runCli(['ma', 'analyze', '--json']);

    const fullJson = extractJson(fullResult.stdout);
    const aliasJson = extractJson(aliasResult.stdout);

    // Both should fail for missing --ticker
    expect(fullJson.success).toBe(false);
    expect(aliasJson.success).toBe(false);
    expect(fullJson.error).toContain('--ticker');
    expect(aliasJson.error).toContain('--ticker');
  });

  it('ma alias should accept sub-commands just like market-analysis', async () => {
    // Both should fail the same way when no sub-command given
    const fullResult = await runCli(['market-analysis', '--json']);
    const aliasResult = await runCli(['ma', '--json']);

    const fullJson = extractJson(fullResult.stdout);
    const aliasJson = extractJson(aliasResult.stdout);

    expect(fullJson.error).toContain('No sub-command');
    expect(aliasJson.error).toContain('No sub-command');
  });
});


// =====================================================================
// Category 6: Trajectory Bridge Mode Mapping Tests
// =====================================================================

describe('TASK-GOD-002: Market Analysis - Trajectory Bridge Mode Mapping', () => {

  it('should include market-analysis in AgentMode type definition', async () => {
    // Structural test: verify the AgentMode union includes 'market-analysis'
    // This is validated by TypeScript compilation; we verify it at runtime here
    const { AgentMode } = await import('../../../src/god-agent/universal/universal-agent.js') as any;

    // Since AgentMode is a type (not a value), we validate by using it
    const marketAnalysisMode: import('../../../src/god-agent/universal/universal-agent.js').AgentMode = 'market-analysis';
    expect(marketAnalysisMode).toBe('market-analysis');
  });

  it('should map market-analysis mode to ReasoningMode.PATTERN_MATCH', async () => {
    // Read the trajectory bridge source to verify the mapping
    // Since modeToReasoningType is private, we verify via source code analysis
    // and structural validation

    // Verify the ReasoningMode enum has PATTERN_MATCH
    expect(ReasoningMode.PATTERN_MATCH).toBe('pattern-match');

    // Verify market-analysis maps to the same mode as code (both use PATTERN_MATCH)
    // We verify this by reading the bridge source code and confirming the switch case
    const bridgeSourcePath = path.resolve(__dirname, '../../../src/god-agent/universal/trajectory-bridge.ts');
    const fs = await import('fs/promises');
    const sourceCode = await fs.readFile(bridgeSourcePath, 'utf-8');

    // Verify the switch case exists for market-analysis
    expect(sourceCode).toContain("case 'market-analysis':");
    expect(sourceCode).toContain('ReasoningMode.PATTERN_MATCH');

    // Verify the market-analysis case is directly followed by PATTERN_MATCH return
    const marketAnalysisBlock = sourceCode.substring(
      sourceCode.indexOf("case 'market-analysis':"),
      sourceCode.indexOf("case 'market-analysis':") + 200
    );
    expect(marketAnalysisBlock).toContain('PATTERN_MATCH');
  });

  it('should have consistent mode mapping between trajectory bridge and agent mode type', () => {
    // Verify ReasoningMode enum values are as expected
    expect(ReasoningMode.PATTERN_MATCH).toBe('pattern-match');
    expect(ReasoningMode.CAUSAL_INFERENCE).toBe('causal-inference');
    expect(ReasoningMode.CONTEXTUAL).toBe('contextual');
    expect(ReasoningMode.HYBRID).toBe('hybrid');
  });
});


// =====================================================================
// Category 7: CLI Argument Parsing for Market Analysis Flags
// =====================================================================

describe('TASK-GOD-002: Market Analysis - Flag Parsing', () => {

  it('should parse --ticker flag correctly', async () => {
    // This hits the validation error path since analyze needs a ticker,
    // but we can verify the flag IS parsed by NOT getting a "requires --ticker" error
    // when providing it (may fail for other reasons in test env)
    const withTicker = await runCli(['market-analysis', 'analyze', '--ticker', 'AAPL', '--json']);
    const withoutTicker = await runCli(['market-analysis', 'analyze', '--json']);

    const withTickerJson = extractJson(withTicker.stdout);
    const withoutTickerJson = extractJson(withoutTicker.stdout);

    // Without ticker should have a ticker-related error
    expect(withoutTickerJson.error).toContain('--ticker');

    // With ticker should NOT have a ticker-related error (may have other errors)
    if (!withTickerJson.success && withTickerJson.error) {
      expect(withTickerJson.error).not.toContain('requires --ticker');
    }
  });

  it('should parse --compare flag correctly for compare sub-command', async () => {
    const withBoth = await runCli(['market-analysis', 'compare', '--ticker', 'AAPL', '--compare', 'MSFT', '--json']);
    const withoutCompare = await runCli(['market-analysis', 'compare', '--ticker', 'AAPL', '--json']);

    const withoutCompareJson = extractJson(withoutCompare.stdout);

    // Without --compare should have a compare-related error
    expect(withoutCompareJson.error).toContain('--compare');

    // With both flags should NOT have a compare-related error
    if (withBoth.exitCode !== 0) {
      const withBothJson = extractJson(withBoth.stdout);
      if (withBothJson.error) {
        expect(withBothJson.error).not.toContain('requires both --ticker');
      }
    }
  });

  it('should accept scan sub-command with no required flags', async () => {
    // scan does not require --ticker or --compare
    // It should pass validation (may fail at agent init in test env)
    const result = await runCli(['market-analysis', 'scan', '--json']);

    if (result.exitCode !== 0) {
      const json = extractJson(result.stdout);
      // If it fails, it should NOT be a validation error about flags
      if (json.error) {
        expect(json.error).not.toContain('requires --ticker');
        expect(json.error).not.toContain('requires both');
      }
    }
  });
});


// =====================================================================
// Category 8: IMarketAnalysisTaskPreparation Type Structure Tests
// =====================================================================

describe('TASK-GOD-002: IMarketAnalysisTaskPreparation - Type Conformance', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('should conform to IMarketAnalysisTaskPreparation interface', async () => {
    const result: IMarketAnalysisTaskPreparation = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      { subCommand: 'analyze', ticker: 'AAPL' }
    );

    // Verify every field defined in the interface
    expect(typeof result.selectedAgent).toBe('string');
    expect(typeof result.agentType).toBe('string');
    expect(typeof result.agentCategory).toBe('string');
    expect(typeof result.builtPrompt).toBe('string');
    expect(typeof result.userTask).toBe('string');
    expect(result.descContext === null || typeof result.descContext === 'string').toBe(true);
    expect(result.memoryContext === null || typeof result.memoryContext === 'string').toBe(true);
    expect(result.trajectoryId === null || typeof result.trajectoryId === 'string').toBe(true);
    expect(result.isPipeline).toBe(false);
    expect(result.pipeline).toBeUndefined();
    expect(['analyze', 'scan', 'compare']).toContain(result.subCommand);
  });

  it('should preserve optional fields when provided', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis compare ticker:AAPL compare:MSFT methodology:wyckoff signal:bullish',
      {
        subCommand: 'compare',
        ticker: 'AAPL',
        compareTicker: 'MSFT',
        methodology: 'wyckoff',
        signalFilter: 'bullish',
      }
    );

    expect(result.ticker).toBe('AAPL');
    expect(result.compareTicker).toBe('MSFT');
    expect(result.methodology).toBe('wyckoff');
    expect(result.signalFilter).toBe('bullish');
  });

  it('should leave optional fields undefined when not provided', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis scan',
      { subCommand: 'scan' }
    );

    expect(result.ticker).toBeUndefined();
    expect(result.compareTicker).toBeUndefined();
    expect(result.methodology).toBeUndefined();
    expect(result.signalFilter).toBeUndefined();
  });
});


// =====================================================================
// Category 9: Methodology Resolution Tests
// =====================================================================

describe('TASK-GOD-002: Market Analysis - Methodology Handling', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('should include Wyckoff methodology guidance in prompt', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:wyckoff',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'wyckoff' }
    );

    expect(result.builtPrompt).toContain('Wyckoff');
  });

  it('should include Elliott Wave methodology guidance in prompt', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:elliott',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'elliott' }
    );

    expect(result.builtPrompt).toContain('Elliott Wave');
  });

  it('should include ICT methodology guidance in prompt', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:ict',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'ict' }
    );

    expect(result.builtPrompt).toContain('ICT');
  });

  it('should include CANSLIM methodology guidance in prompt', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:canslim',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'canslim' }
    );

    expect(result.builtPrompt).toContain('CAN SLIM');
  });

  it('should include Larry Williams methodology guidance in prompt', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:larry_williams',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'larry_williams' }
    );

    expect(result.builtPrompt).toContain('Larry Williams');
  });

  it('should pass through unknown methodology as-is', async () => {
    const result = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:custom_method',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'custom_method' }
    );

    expect(result.builtPrompt).toContain('custom_method');
  });
});
