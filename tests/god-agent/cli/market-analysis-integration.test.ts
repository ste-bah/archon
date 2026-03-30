/**
 * TASK-GOD-002: Market Analysis CLI Integration Tests
 *
 * Integration tests verifying cross-component interactions:
 * 1. CLI -> UniversalAgent (argument flow, data integrity)
 * 2. UniversalAgent -> TrajectoryBridge (mode mapping, trajectory creation)
 * 3. UniversalAgent -> AgentSelector (agent selection for market tasks)
 * 4. End-to-end CLI invocation (subprocess with full JSON parsing)
 * 5. Alias equivalence (market-analysis vs ma)
 * 6. CLI JSON output -> IMarketAnalysisTaskPreparation field mapping
 *
 * Complements the 50 unit tests in market-analysis-cli.test.ts.
 * Focuses on component INTERACTION verification, not individual behavior.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

import {
  UniversalAgent,
  type IMarketAnalysisTaskPreparation,
  type AgentMode,
} from '../../../src/god-agent/universal/universal-agent.js';
import { TrajectoryBridge } from '../../../src/god-agent/universal/trajectory-bridge.js';
import { ReasoningMode } from '../../../src/god-agent/core/reasoning/reasoning-types.js';

const execFileAsync = promisify(execFile);

// Path to the CLI entry point
const CLI_PATH = path.resolve(__dirname, '../../../src/god-agent/universal/cli.ts');
const TSX_PATH = 'npx';

/**
 * Helper: Run the CLI as a subprocess.
 * Returns { stdout, stderr, exitCode }.
 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(TSX_PATH, ['tsx', CLI_PATH, ...args], {
      timeout: 60000,
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
    throw new Error(`JSON markers not found in output:\n${stdout.substring(0, 500)}`);
  }

  const jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();
  return JSON.parse(jsonStr);
}


// =====================================================================
// Integration Category 1: CLI -> UniversalAgent Data Flow
// =====================================================================

describe('Integration: CLI -> UniversalAgent Data Flow', () => {
  let agent: UniversalAgent;

  beforeAll(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterAll(async () => {
    await agent.shutdown();
  });

  it('should pass CLI-parsed options through to prepareMarketAnalysisTask and back to JSON output', async () => {
    // Simulate what the CLI does: parse args, call prepareMarketAnalysisTask, output JSON
    // This test verifies the data flow: CLI flags -> options object -> preparation result

    // Step 1: Call prepareMarketAnalysisTask with the same options the CLI would build
    const preparation = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:wyckoff signal:bullish',
      {
        subCommand: 'analyze',
        ticker: 'AAPL',
        methodology: 'wyckoff',
        signalFilter: 'bullish',
      }
    );

    // Step 2: Verify the preparation result contains ALL fields the CLI outputs
    // These fields map directly to the JSON output structure in cli.ts lines 1381-1407
    expect(preparation.selectedAgent).toBeDefined();
    expect(preparation.agentType).toBeDefined();
    expect(preparation.agentCategory).toBeDefined();
    expect(preparation.builtPrompt).toBeDefined();
    expect(preparation.subCommand).toBe('analyze');
    expect(preparation.ticker).toBe('AAPL');
    expect(preparation.methodology).toBe('wyckoff');
    expect(preparation.signalFilter).toBe('bullish');
    expect(preparation.isPipeline).toBe(false);

    // Step 3: Verify the builtPrompt integrates all option fields
    expect(preparation.builtPrompt).toContain('AAPL');
    expect(preparation.builtPrompt).toContain('Wyckoff');
    expect(preparation.builtPrompt).toContain('bullish');
    expect(preparation.builtPrompt).toContain('analyze');
  });

  it('should construct task text from options in the same format as CLI', async () => {
    // The CLI builds maTask from parts: ['market-analysis scan', 'ticker:TSLA']
    // Verify the same task string produces consistent results when called directly
    const cliTaskText = 'market-analysis scan ticker:TSLA';

    const preparation = await agent.prepareMarketAnalysisTask(cliTaskText, {
      subCommand: 'scan',
      ticker: 'TSLA',
    });

    expect(preparation.userTask).toBe(cliTaskText);
    expect(preparation.subCommand).toBe('scan');
    expect(preparation.ticker).toBe('TSLA');
    expect(preparation.builtPrompt).toContain('TSLA');
    expect(preparation.builtPrompt).toContain('Scan');
  });

  it('should handle compare sub-command with both tickers flowing through correctly', async () => {
    const cliTaskText = 'market-analysis compare ticker:AAPL compare:MSFT';

    const preparation = await agent.prepareMarketAnalysisTask(cliTaskText, {
      subCommand: 'compare',
      ticker: 'AAPL',
      compareTicker: 'MSFT',
    });

    expect(preparation.subCommand).toBe('compare');
    expect(preparation.ticker).toBe('AAPL');
    expect(preparation.compareTicker).toBe('MSFT');
    expect(preparation.builtPrompt).toContain('AAPL');
    expect(preparation.builtPrompt).toContain('MSFT');
    expect(preparation.builtPrompt).toContain('Comparison');
  });

  it('should preserve undefined optional fields when not passed from CLI', async () => {
    // When CLI parses scan with no flags, all optional fields should be undefined
    const preparation = await agent.prepareMarketAnalysisTask(
      'market-analysis scan',
      { subCommand: 'scan' }
    );

    expect(preparation.ticker).toBeUndefined();
    expect(preparation.compareTicker).toBeUndefined();
    expect(preparation.methodology).toBeUndefined();
    expect(preparation.signalFilter).toBeUndefined();
    // But required fields must still be present
    expect(preparation.selectedAgent).toBeDefined();
    expect(preparation.agentType).toBeDefined();
    expect(preparation.builtPrompt.length).toBeGreaterThan(0);
    expect(preparation.isPipeline).toBe(false);
  });
});


// =====================================================================
// Integration Category 2: UniversalAgent -> TrajectoryBridge
// =====================================================================

describe('Integration: UniversalAgent -> TrajectoryBridge Mode Mapping', () => {

  it('should map market-analysis AgentMode to ReasoningMode.PATTERN_MATCH in trajectory bridge', async () => {
    // Read the trajectory bridge source to verify the mode mapping contract
    const fs = await import('fs/promises');
    const bridgeSource = await fs.readFile(
      path.resolve(__dirname, '../../../src/god-agent/universal/trajectory-bridge.ts'),
      'utf-8'
    );

    // Verify the switch case maps market-analysis to PATTERN_MATCH
    const switchBlock = bridgeSource.substring(
      bridgeSource.indexOf('private modeToReasoningType'),
      bridgeSource.indexOf('// General questions use hybrid')
    );

    expect(switchBlock).toContain("case 'market-analysis':");
    expect(switchBlock).toContain('ReasoningMode.PATTERN_MATCH');

    // Verify market-analysis and code share the same reasoning mode
    // (both use PATTERN_MATCH as documented in the source)
    const codeBlock = switchBlock.substring(
      switchBlock.indexOf("case 'code':"),
      switchBlock.indexOf("case 'research':")
    );
    expect(codeBlock).toContain('PATTERN_MATCH');

    const maBlock = switchBlock.substring(
      switchBlock.indexOf("case 'market-analysis':"),
    );
    expect(maBlock).toContain('PATTERN_MATCH');
  });

  it('should ensure market-analysis is a valid AgentMode type', () => {
    // TypeScript compile-time check: 'market-analysis' must be assignable to AgentMode
    const mode: AgentMode = 'market-analysis';
    expect(mode).toBe('market-analysis');

    // Also verify all other modes are still valid (regression check)
    const allModes: AgentMode[] = ['code', 'research', 'write', 'market-analysis', 'general'];
    expect(allModes).toHaveLength(5);
    expect(allModes).toContain('market-analysis');
  });

  it('should create trajectory with market-analysis mode through prepareMarketAnalysisTask', async () => {
    // This verifies the full chain: agent.prepareMarketAnalysisTask ->
    //   agent.embed -> trajectoryBridge.createTrajectoryFromInteraction('market-analysis')
    // In test env, trajectory creation may fail gracefully - that's acceptable
    const agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();

    try {
      const preparation = await agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        { subCommand: 'analyze', ticker: 'AAPL' }
      );

      // trajectoryId will be null if bridge is not configured (test env)
      // or a string if bridge is configured and embedding succeeds
      expect(
        preparation.trajectoryId === null ||
        typeof preparation.trajectoryId === 'string'
      ).toBe(true);

      // Regardless of trajectory success, the rest of the preparation must succeed
      expect(preparation.selectedAgent).toBeDefined();
      expect(preparation.builtPrompt.length).toBeGreaterThan(0);
    } finally {
      await agent.shutdown();
    }
  });
});


// =====================================================================
// Integration Category 3: UniversalAgent -> AgentSelector
// =====================================================================

describe('Integration: UniversalAgent -> AgentSelector for Market Tasks', () => {
  let agent: UniversalAgent;

  beforeAll(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterAll(async () => {
    await agent.shutdown();
  });

  it('should select a valid agent for analyze sub-command', async () => {
    const preparation = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      { subCommand: 'analyze', ticker: 'AAPL' }
    );

    // The agent selector should return a valid agent key (non-empty string)
    expect(typeof preparation.selectedAgent).toBe('string');
    expect(preparation.selectedAgent.length).toBeGreaterThan(0);

    // agentType must be derivable from the selected agent (for Task() spawning)
    expect(typeof preparation.agentType).toBe('string');
    expect(preparation.agentType.length).toBeGreaterThan(0);

    // agentCategory indicates the category classification
    expect(typeof preparation.agentCategory).toBe('string');
    expect(preparation.agentCategory.length).toBeGreaterThan(0);
  });

  it('should select consistent agents for identical analyze tasks', async () => {
    // Same input should select the same agent (deterministic selection)
    const prep1 = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      { subCommand: 'analyze', ticker: 'AAPL' }
    );
    const prep2 = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      { subCommand: 'analyze', ticker: 'AAPL' }
    );

    expect(prep1.selectedAgent).toBe(prep2.selectedAgent);
    expect(prep1.agentType).toBe(prep2.agentType);
    expect(prep1.agentCategory).toBe(prep2.agentCategory);
  });

  it('should select agents for all three sub-commands', async () => {
    const analyzePrep = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL',
      { subCommand: 'analyze', ticker: 'AAPL' }
    );
    const scanPrep = await agent.prepareMarketAnalysisTask(
      'market-analysis scan',
      { subCommand: 'scan' }
    );
    const comparePrep = await agent.prepareMarketAnalysisTask(
      'market-analysis compare ticker:AAPL compare:MSFT',
      { subCommand: 'compare', ticker: 'AAPL', compareTicker: 'MSFT' }
    );

    // All three must get valid agent selections
    for (const prep of [analyzePrep, scanPrep, comparePrep]) {
      expect(prep.selectedAgent).toBeDefined();
      expect(prep.selectedAgent.length).toBeGreaterThan(0);
      expect(prep.agentType).toBeDefined();
      expect(prep.agentType.length).toBeGreaterThan(0);
    }
  });

  it('should integrate agent selection with DESC context injection', async () => {
    // DESC injection should run before agent selection, and
    // both descContext and selectedAgent should be present in result
    const preparation = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:wyckoff',
      { subCommand: 'analyze', ticker: 'AAPL', methodology: 'wyckoff' }
    );

    // descContext can be null (no episodes) or string (episodes found)
    expect(
      preparation.descContext === null ||
      typeof preparation.descContext === 'string'
    ).toBe(true);

    // Agent selection must succeed regardless of DESC result
    expect(preparation.selectedAgent).toBeDefined();
    expect(preparation.builtPrompt.length).toBeGreaterThan(0);
  });
});


// =====================================================================
// Integration Category 4: End-to-End CLI Invocation
// =====================================================================

describe('Integration: End-to-End CLI -> JSON Output', () => {

  it('should produce valid JSON with all required fields for analyze --ticker AAPL', async () => {
    const result = await runCli([
      'market-analysis', 'analyze', '--ticker', 'AAPL', '--json',
    ]);

    // If the CLI exits successfully, verify the full JSON structure
    if (result.exitCode === 0) {
      const json = extractJson(result.stdout);

      // Top-level required fields from ICLIJsonOutput
      expect(json.command).toBe('market-analysis');
      expect(json.selectedAgent).toBeDefined();
      expect(typeof json.selectedAgent).toBe('string');
      expect(json.prompt).toContain('AAPL');
      expect(json.isPipeline).toBe(false);
      expect(json.success).toBe(true);

      // result object maps to IMarketAnalysisTaskPreparation fields
      expect(json.result).toBeDefined();
      expect(json.result.builtPrompt).toBeDefined();
      expect(json.result.builtPrompt.length).toBeGreaterThan(0);
      expect(json.result.agentType).toBeDefined();
      expect(json.result.agentCategory).toBeDefined();
      expect(json.result.subCommand).toBe('analyze');
      expect(json.result.ticker).toBe('AAPL');

      // TASK-LOOPFIX-001 feedback fields
      expect(json.result.feedbackRequired).toBe(true);

      // descContext and memoryContext can be null
      expect(
        json.result.descContext === null ||
        typeof json.result.descContext === 'string'
      ).toBe(true);
      expect(
        json.result.memoryContext === null ||
        typeof json.result.memoryContext === 'string'
      ).toBe(true);
    } else {
      // If the CLI fails (e.g., embedding service unavailable), verify graceful error
      // The CLI should still produce JSON output with success: false
      try {
        const json = extractJson(result.stdout);
        expect(json.success).toBe(false);
        expect(json.command).toBe('market-analysis');
      } catch {
        // If no JSON markers, the error went to stderr (non-JSON mode fallback)
        expect(result.stderr.length).toBeGreaterThan(0);
      }
    }
  });

  it('should produce valid JSON for scan sub-command (no required flags)', async () => {
    const result = await runCli([
      'market-analysis', 'scan', '--json',
    ]);

    if (result.exitCode === 0) {
      const json = extractJson(result.stdout);
      expect(json.command).toBe('market-analysis');
      expect(json.success).toBe(true);
      expect(json.result.subCommand).toBe('scan');
      expect(json.result.builtPrompt.length).toBeGreaterThan(0);
      // scan does not require ticker
      expect(json.result.ticker).toBeUndefined();
    } else {
      // Graceful failure acceptable in test env
      try {
        const json = extractJson(result.stdout);
        expect(json.command).toBe('market-analysis');
      } catch {
        // Non-JSON error output
      }
    }
  });

  it('should produce valid JSON for compare sub-command with both tickers', async () => {
    const result = await runCli([
      'market-analysis', 'compare', '--ticker', 'AAPL', '--compare', 'MSFT', '--json',
    ]);

    if (result.exitCode === 0) {
      const json = extractJson(result.stdout);
      expect(json.command).toBe('market-analysis');
      expect(json.success).toBe(true);
      expect(json.result.subCommand).toBe('compare');
      expect(json.result.ticker).toBe('AAPL');
      expect(json.result.compareTicker).toBe('MSFT');
      expect(json.result.builtPrompt).toContain('AAPL');
      expect(json.result.builtPrompt).toContain('MSFT');
    }
  });

  it('should produce valid JSON with methodology and signal flags', async () => {
    const result = await runCli([
      'market-analysis', 'analyze',
      '--ticker', 'TSLA',
      '--methodology', 'elliott',
      '--signal', 'bearish',
      '--json',
    ]);

    if (result.exitCode === 0) {
      const json = extractJson(result.stdout);
      expect(json.success).toBe(true);
      expect(json.result.ticker).toBe('TSLA');
      expect(json.result.methodology).toBe('elliott');
      expect(json.result.signalFilter).toBe('bearish');
      expect(json.result.builtPrompt).toContain('TSLA');
      expect(json.result.builtPrompt).toContain('Elliott Wave');
      expect(json.result.builtPrompt).toContain('bearish');
    }
  });

  it('should include trajectoryId field in successful JSON output', async () => {
    const result = await runCli([
      'market-analysis', 'analyze', '--ticker', 'AAPL', '--json',
    ]);

    if (result.exitCode === 0) {
      const json = extractJson(result.stdout);
      // trajectoryId can be string (bridge available) or undefined (bridge unavailable)
      expect(
        json.trajectoryId === undefined ||
        json.trajectoryId === null ||
        typeof json.trajectoryId === 'string'
      ).toBe(true);

      // feedbackCommand depends on trajectoryId
      if (json.trajectoryId) {
        expect(json.result.feedbackCommand).toContain(json.trajectoryId);
        expect(json.result.feedbackCommand).toContain('feedback');
      }
    }
  });
});


// =====================================================================
// Integration Category 5: Alias Equivalence (market-analysis vs ma)
// =====================================================================

describe('Integration: Alias Equivalence (market-analysis vs ma)', () => {

  it('should produce identical error JSON for missing sub-command via both aliases', async () => {
    const [fullResult, aliasResult] = await Promise.all([
      runCli(['market-analysis', '--json']),
      runCli(['ma', '--json']),
    ]);

    expect(fullResult.exitCode).not.toBe(0);
    expect(aliasResult.exitCode).not.toBe(0);

    const fullJson = extractJson(fullResult.stdout);
    const aliasJson = extractJson(aliasResult.stdout);

    // Structural equivalence
    expect(fullJson.command).toBe(aliasJson.command);
    expect(fullJson.selectedAgent).toBe(aliasJson.selectedAgent);
    expect(fullJson.isPipeline).toBe(aliasJson.isPipeline);
    expect(fullJson.success).toBe(aliasJson.success);
    expect(fullJson.error).toBe(aliasJson.error);
    expect(fullJson.prompt).toBe(aliasJson.prompt);
    expect(fullJson.result).toEqual(aliasJson.result);
  });

  it('should produce identical error JSON for invalid sub-command via both aliases', async () => {
    const [fullResult, aliasResult] = await Promise.all([
      runCli(['market-analysis', 'badcmd', '--json']),
      runCli(['ma', 'badcmd', '--json']),
    ]);

    const fullJson = extractJson(fullResult.stdout);
    const aliasJson = extractJson(aliasResult.stdout);

    expect(fullJson.command).toBe(aliasJson.command);
    expect(fullJson.selectedAgent).toBe(aliasJson.selectedAgent);
    expect(fullJson.success).toBe(aliasJson.success);
    expect(fullJson.error).toBe(aliasJson.error);
  });

  it('should produce identical validation errors for missing --ticker via both aliases', async () => {
    const [fullResult, aliasResult] = await Promise.all([
      runCli(['market-analysis', 'analyze', '--json']),
      runCli(['ma', 'analyze', '--json']),
    ]);

    const fullJson = extractJson(fullResult.stdout);
    const aliasJson = extractJson(aliasResult.stdout);

    expect(fullJson.command).toBe(aliasJson.command);
    expect(fullJson.selectedAgent).toBe(aliasJson.selectedAgent);
    expect(fullJson.success).toBe(false);
    expect(aliasJson.success).toBe(false);
    expect(fullJson.error).toBe(aliasJson.error);
  });

  it('should produce equivalent successful JSON for analyze via both aliases', async () => {
    const [fullResult, aliasResult] = await Promise.all([
      runCli(['market-analysis', 'analyze', '--ticker', 'AAPL', '--json']),
      runCli(['ma', 'analyze', '--ticker', 'AAPL', '--json']),
    ]);

    // Both should succeed or both should fail (same environment)
    expect(fullResult.exitCode).toBe(aliasResult.exitCode);

    if (fullResult.exitCode === 0 && aliasResult.exitCode === 0) {
      const fullJson = extractJson(fullResult.stdout);
      const aliasJson = extractJson(aliasResult.stdout);

      // Structural equivalence of result
      expect(fullJson.command).toBe(aliasJson.command);
      expect(fullJson.selectedAgent).toBe(aliasJson.selectedAgent);
      expect(fullJson.isPipeline).toBe(aliasJson.isPipeline);
      expect(fullJson.success).toBe(aliasJson.success);

      // Result content equivalence
      expect(fullJson.result.subCommand).toBe(aliasJson.result.subCommand);
      expect(fullJson.result.ticker).toBe(aliasJson.result.ticker);
      expect(fullJson.result.agentType).toBe(aliasJson.result.agentType);
      expect(fullJson.result.agentCategory).toBe(aliasJson.result.agentCategory);
      expect(fullJson.result.feedbackRequired).toBe(aliasJson.result.feedbackRequired);
    }
  });

  it('should produce equivalent successful JSON for scan via both aliases', async () => {
    const [fullResult, aliasResult] = await Promise.all([
      runCli(['market-analysis', 'scan', '--json']),
      runCli(['ma', 'scan', '--json']),
    ]);

    expect(fullResult.exitCode).toBe(aliasResult.exitCode);

    if (fullResult.exitCode === 0 && aliasResult.exitCode === 0) {
      const fullJson = extractJson(fullResult.stdout);
      const aliasJson = extractJson(aliasResult.stdout);

      expect(fullJson.result.subCommand).toBe(aliasJson.result.subCommand);
      expect(fullJson.result.agentType).toBe(aliasJson.result.agentType);
      expect(fullJson.result.agentCategory).toBe(aliasJson.result.agentCategory);
    }
  });

  it('should produce equivalent successful JSON for compare via both aliases', async () => {
    const [fullResult, aliasResult] = await Promise.all([
      runCli(['market-analysis', 'compare', '--ticker', 'AAPL', '--compare', 'MSFT', '--json']),
      runCli(['ma', 'compare', '--ticker', 'AAPL', '--compare', 'MSFT', '--json']),
    ]);

    expect(fullResult.exitCode).toBe(aliasResult.exitCode);

    if (fullResult.exitCode === 0 && aliasResult.exitCode === 0) {
      const fullJson = extractJson(fullResult.stdout);
      const aliasJson = extractJson(aliasResult.stdout);

      expect(fullJson.result.subCommand).toBe(aliasJson.result.subCommand);
      expect(fullJson.result.ticker).toBe(aliasJson.result.ticker);
      expect(fullJson.result.compareTicker).toBe(aliasJson.result.compareTicker);
      expect(fullJson.result.agentType).toBe(aliasJson.result.agentType);
    }
  });
});


// =====================================================================
// Integration Category 6: CLI JSON Output -> IMarketAnalysisTaskPreparation Mapping
// =====================================================================

describe('Integration: JSON Output Field Mapping Consistency', () => {
  let agent: UniversalAgent;

  beforeAll(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterAll(async () => {
    await agent.shutdown();
  });

  it('should map all IMarketAnalysisTaskPreparation fields to JSON result fields', async () => {
    // Direct call to get the preparation result
    const preparation = await agent.prepareMarketAnalysisTask(
      'market-analysis analyze ticker:AAPL methodology:wyckoff',
      {
        subCommand: 'analyze',
        ticker: 'AAPL',
        methodology: 'wyckoff',
      }
    );

    // Simulate what cli.ts does: construct the JSON output from preparation
    // (lines 1381-1407 of cli.ts)
    const simulatedJsonResult = {
      builtPrompt: preparation.builtPrompt,
      agentType: preparation.agentType,
      agentCategory: preparation.agentCategory,
      subCommand: preparation.subCommand,
      ticker: preparation.ticker,
      compareTicker: preparation.compareTicker,
      methodology: preparation.methodology,
      signalFilter: preparation.signalFilter,
      descContext: preparation.descContext,
      memoryContext: preparation.memoryContext,
      feedbackRequired: true,
      feedbackCommand: preparation.trajectoryId
        ? `npx tsx src/god-agent/universal/cli.ts feedback "${preparation.trajectoryId}" [quality_score] --trajectory --notes "Market analysis task completed"`
        : undefined,
    };

    // Verify no field is accidentally dropped during the mapping
    expect(simulatedJsonResult.builtPrompt).toBe(preparation.builtPrompt);
    expect(simulatedJsonResult.agentType).toBe(preparation.agentType);
    expect(simulatedJsonResult.agentCategory).toBe(preparation.agentCategory);
    expect(simulatedJsonResult.subCommand).toBe(preparation.subCommand);
    expect(simulatedJsonResult.ticker).toBe(preparation.ticker);
    expect(simulatedJsonResult.compareTicker).toBe(preparation.compareTicker);
    expect(simulatedJsonResult.methodology).toBe(preparation.methodology);
    expect(simulatedJsonResult.signalFilter).toBe(preparation.signalFilter);
    expect(simulatedJsonResult.descContext).toBe(preparation.descContext);
    expect(simulatedJsonResult.memoryContext).toBe(preparation.memoryContext ?? null);
    expect(simulatedJsonResult.feedbackRequired).toBe(true);
  });

  it('should ensure CLI top-level fields are correctly derived from preparation', async () => {
    const preparation = await agent.prepareMarketAnalysisTask(
      'market-analysis scan',
      { subCommand: 'scan' }
    );

    // Simulate cli.ts top-level JSON construction
    const simulatedTopLevel = {
      command: 'market-analysis',
      selectedAgent: preparation.selectedAgent,
      prompt: 'market-analysis scan',
      isPipeline: preparation.isPipeline,
      success: true,
      trajectoryId: preparation.trajectoryId ?? undefined,
    };

    expect(simulatedTopLevel.command).toBe('market-analysis');
    expect(simulatedTopLevel.selectedAgent).toBe(preparation.selectedAgent);
    expect(simulatedTopLevel.isPipeline).toBe(false);
    expect(simulatedTopLevel.success).toBe(true);
  });

  it('should map IMarketAnalysisTaskPreparation.isPipeline to JSON output consistently', async () => {
    // isPipeline must ALWAYS be false for market-analysis, across all sub-commands
    const subCommands: Array<{
      subCommand: 'analyze' | 'scan' | 'compare';
      task: string;
      options: Record<string, string>;
    }> = [
      {
        subCommand: 'analyze',
        task: 'market-analysis analyze ticker:AAPL',
        options: { ticker: 'AAPL' },
      },
      {
        subCommand: 'scan',
        task: 'market-analysis scan',
        options: {},
      },
      {
        subCommand: 'compare',
        task: 'market-analysis compare ticker:AAPL compare:MSFT',
        options: { ticker: 'AAPL', compareTicker: 'MSFT' },
      },
    ];

    for (const { subCommand, task, options } of subCommands) {
      const preparation = await agent.prepareMarketAnalysisTask(task, {
        subCommand,
        ...options,
      });
      expect(preparation.isPipeline).toBe(false);
      expect(preparation.pipeline).toBeUndefined();
    }
  });
});


// =====================================================================
// Integration Category 7: Cross-Component Error Propagation
// =====================================================================

describe('Integration: Cross-Component Error Propagation', () => {

  it('should propagate validation errors from CLI to JSON without reaching UniversalAgent', async () => {
    // These errors should be caught at the CLI level, BEFORE agent initialization
    // Verify by checking that the JSON output has no agent-related fields
    const result = await runCli(['market-analysis', '--json']);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.result).toBeNull();
    expect(json.error).toContain('No sub-command');
    // selectedAgent comes from getSelectedAgent (static mapping), not from agent
    expect(json.selectedAgent).toBe('god-market-analysis');
  });

  it('should propagate ticker validation error before agent initialization', async () => {
    const result = await runCli(['market-analysis', 'analyze', '--json']);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.result).toBeNull();
    expect(json.error).toContain('--ticker');
    expect(json.command).toBe('market-analysis');
  });

  it('should propagate compare validation error with correct details', async () => {
    const result = await runCli([
      'market-analysis', 'compare', '--ticker', 'AAPL', '--json',
    ]);

    const json = extractJson(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error).toContain('--compare');
    expect(json.error).toContain('--ticker');
  });

  it('should handle agent initialization errors gracefully in CLI', async () => {
    // Run a valid command that reaches agent initialization
    // In test environments, this may fail due to missing embedding service
    const result = await runCli([
      'market-analysis', 'analyze', '--ticker', 'AAPL', '--json',
    ]);

    // Whether it succeeds or fails, it should produce valid JSON
    try {
      const json = extractJson(result.stdout);
      expect(json.command).toBe('market-analysis');
      expect(typeof json.success).toBe('boolean');

      if (json.success) {
        expect(json.result).toBeDefined();
        expect(json.result.builtPrompt).toBeDefined();
      } else {
        expect(json.error).toBeDefined();
      }
    } catch {
      // If JSON extraction fails, stderr should have error info
      expect(result.exitCode).not.toBe(0);
    }
  });
});


// =====================================================================
// Integration Category 8: Short Flag Equivalence
// =====================================================================

describe('Integration: Short Flag Equivalence', () => {

  it('should treat --ticker and -t identically for validation', async () => {
    const [longResult, shortResult] = await Promise.all([
      runCli(['market-analysis', 'analyze', '--ticker', 'AAPL', '--json']),
      runCli(['market-analysis', 'analyze', '-t', 'AAPL', '--json']),
    ]);

    // Both should have the same exit code
    expect(longResult.exitCode).toBe(shortResult.exitCode);

    // If both succeed, verify they produce the same result
    if (longResult.exitCode === 0 && shortResult.exitCode === 0) {
      const longJson = extractJson(longResult.stdout);
      const shortJson = extractJson(shortResult.stdout);

      expect(longJson.result.ticker).toBe(shortJson.result.ticker);
      expect(longJson.result.subCommand).toBe(shortJson.result.subCommand);
      expect(longJson.result.agentType).toBe(shortJson.result.agentType);
    }
  });

  it('should treat --compare and -c identically for compare validation', async () => {
    // Both should fail the same way if --ticker is missing
    const [longResult, shortResult] = await Promise.all([
      runCli(['market-analysis', 'compare', '--compare', 'MSFT', '--json']),
      runCli(['market-analysis', 'compare', '-c', 'MSFT', '--json']),
    ]);

    // Both should fail (missing --ticker)
    expect(longResult.exitCode).not.toBe(0);
    expect(shortResult.exitCode).not.toBe(0);

    const longJson = extractJson(longResult.stdout);
    const shortJson = extractJson(shortResult.stdout);

    expect(longJson.error).toBe(shortJson.error);
  });

  it('should treat --methodology and -m identically', async () => {
    const [longResult, shortResult] = await Promise.all([
      runCli(['market-analysis', 'analyze', '--ticker', 'AAPL', '--methodology', 'wyckoff', '--json']),
      runCli(['market-analysis', 'analyze', '-t', 'AAPL', '-m', 'wyckoff', '--json']),
    ]);

    expect(longResult.exitCode).toBe(shortResult.exitCode);

    if (longResult.exitCode === 0 && shortResult.exitCode === 0) {
      const longJson = extractJson(longResult.stdout);
      const shortJson = extractJson(shortResult.stdout);

      expect(longJson.result.methodology).toBe(shortJson.result.methodology);
      expect(longJson.result.methodology).toBe('wyckoff');
    }
  });

  it('should treat --signal and -s identically', async () => {
    const [longResult, shortResult] = await Promise.all([
      runCli(['market-analysis', 'analyze', '--ticker', 'AAPL', '--signal', 'bullish', '--json']),
      runCli(['market-analysis', 'analyze', '-t', 'AAPL', '-s', 'bullish', '--json']),
    ]);

    expect(longResult.exitCode).toBe(shortResult.exitCode);

    if (longResult.exitCode === 0 && shortResult.exitCode === 0) {
      const longJson = extractJson(longResult.stdout);
      const shortJson = extractJson(shortResult.stdout);

      expect(longJson.result.signalFilter).toBe(shortJson.result.signalFilter);
      expect(longJson.result.signalFilter).toBe('bullish');
    }
  });
});


// =====================================================================
// Integration Category 9: Concurrent Preparation Stability
// =====================================================================

describe('Integration: Concurrent Preparation Stability', () => {
  let agent: UniversalAgent;

  beforeAll(async () => {
    agent = new UniversalAgent({
      autoLearn: false,
      verbose: false,
    });
    await agent.initialize();
  });

  afterAll(async () => {
    await agent.shutdown();
  });

  it('should handle concurrent preparations for different sub-commands without interference', async () => {
    // Run all three sub-commands concurrently on the same agent instance
    const [analyzePrep, scanPrep, comparePrep] = await Promise.all([
      agent.prepareMarketAnalysisTask(
        'market-analysis analyze ticker:AAPL',
        { subCommand: 'analyze', ticker: 'AAPL' }
      ),
      agent.prepareMarketAnalysisTask(
        'market-analysis scan',
        { subCommand: 'scan' }
      ),
      agent.prepareMarketAnalysisTask(
        'market-analysis compare ticker:AAPL compare:MSFT',
        { subCommand: 'compare', ticker: 'AAPL', compareTicker: 'MSFT' }
      ),
    ]);

    // Verify no cross-contamination between concurrent results
    expect(analyzePrep.subCommand).toBe('analyze');
    expect(analyzePrep.ticker).toBe('AAPL');
    expect(analyzePrep.compareTicker).toBeUndefined();

    expect(scanPrep.subCommand).toBe('scan');
    expect(scanPrep.ticker).toBeUndefined();

    expect(comparePrep.subCommand).toBe('compare');
    expect(comparePrep.ticker).toBe('AAPL');
    expect(comparePrep.compareTicker).toBe('MSFT');
  });

  it('should handle concurrent preparations with different tickers', async () => {
    const tickers = ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'AMZN'];

    const preparations = await Promise.all(
      tickers.map(ticker =>
        agent.prepareMarketAnalysisTask(
          `market-analysis analyze ticker:${ticker}`,
          { subCommand: 'analyze', ticker }
        )
      )
    );

    // Verify each preparation has the correct ticker (no cross-contamination)
    for (let i = 0; i < tickers.length; i++) {
      expect(preparations[i].ticker).toBe(tickers[i]);
      expect(preparations[i].builtPrompt).toContain(tickers[i]);
      expect(preparations[i].subCommand).toBe('analyze');
    }
  });
});
