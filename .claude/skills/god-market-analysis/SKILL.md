---
name: god-market-analysis
description: Analyze market tickers using the Universal Self-Learning God Agent with DAI-001 agent selection (analyze, scan, compare)
---

Run market analysis using the Universal Self-Learning God Agent with DAI-001 dynamic agent selection.

**Request:** $ARGUMENTS

---

## EXECUTION PROTOCOL

**YOU MUST use the universal CLI for task preparation and Task() for execution. DO NOT do the analysis directly.**

### CRITICAL: DO NOT STOP DURING EXECUTION

**The user has ALREADY decided to run this analysis by invoking /god-market-analysis. Their confirmation is the invocation itself.**

- **DO NOT** pause to ask "should I continue?" after getting CLI output
- **DO NOT** stop to present options about methodology or approach
- **DO NOT** say "this will take a long time, would you like to proceed?"
- **DO NOT** offer to skip the feedback step
- **DO NOT** comment on token usage, context limits, or duration estimates
- **JUST EXECUTE** Steps 1 through 5 without interruption
- The ONLY reason to stop is an actual error (CLI crash, `success: false`)

---

### Step 1: Parse Arguments and Build CLI Command

Parse `$ARGUMENTS` to determine the analysis mode and build the CLI command.

**Mode Detection:**
- **scan** mode: arguments contain "scan", "screen", "find", or "search for"
- **compare** mode: arguments contain "compare", "vs", "versus", or two ticker symbols
- **analyze** mode: default (bare ticker symbol, or explicit "analyze")

**Extraction Rules:**
- **Ticker**: 1-5 uppercase alphabetic characters (auto-uppercase from input)
- **Methodology**: wyckoff, elliott, ict, canslim, larry_williams
- **Signal filter** (scan mode): bullish, bearish, neutral

**Build the CLI command based on detected mode:**

For **analyze** mode:
```bash
npx tsx src/god-agent/universal/cli.ts market-analysis analyze --ticker <TICKER> [--methodology <method>] --json
```

For **scan** mode:
```bash
npx tsx src/god-agent/universal/cli.ts market-analysis scan [--signal <signal>] [--methodology <method>] --json
```

For **compare** mode:
```bash
npx tsx src/god-agent/universal/cli.ts market-analysis compare --ticker <TICKER1> --compare <TICKER2> [--methodology <method>] --json
```

**Examples:**
- `$ARGUMENTS` = "AAPL wyckoff" => `market-analysis analyze --ticker AAPL --methodology wyckoff --json`
- `$ARGUMENTS` = "scan bullish ict" => `market-analysis scan --signal bullish --methodology ict --json`
- `$ARGUMENTS` = "AAPL vs MSFT" => `market-analysis compare --ticker AAPL --compare MSFT --json`
- `$ARGUMENTS` = "TSLA canslim" => `market-analysis analyze --ticker TSLA --methodology canslim --json`

Run the constructed command.

### Step 2: Parse CLI Output

The CLI wraps JSON output in sentinels. Extract the JSON between `__GODAGENT_JSON_START__` and `__GODAGENT_JSON_END__`.

Expected JSON structure:
```json
{
  "command": "market-analysis",
  "selectedAgent": "god-market-analysis",
  "prompt": "market-analysis analyze ticker:AAPL",
  "isPipeline": true,
  "result": {
    "builtPrompt": "...",
    "agentType": "market-analyst",
    "agentCategory": "...",
    "subCommand": "analyze",
    "ticker": "AAPL",
    "compareTicker": null,
    "methodology": null,
    "signalFilter": null,
    "pipeline": {
      "ticker": "AAPL",
      "dataSourcePriority": ["market-terminal", "perplexity", "websearch"],
      "phases": [
        { "phase": 1, "name": "Data Collection", "parallel": true, "agents": [...] },
        { "phase": 2, "name": "Methodology Analysis", "parallel": true, "agents": [...] },
        { "phase": 3, "name": "Aggregation", "parallel": false, "agents": [...] },
        { "phase": 4, "name": "Output", "parallel": false, "agents": [...] }
      ]
    },
    "feedbackRequired": true,
    "feedbackCommand": "npx tsx src/god-agent/universal/cli.ts feedback \"trj_xxx\" [quality_score] --trajectory --notes \"Market analysis task completed\""
  },
  "success": true,
  "trajectoryId": "trj_xxx"
}
```

Each agent in the pipeline has: `{ key, name, prompt, mcpTools, memoryReads, memoryWrites }`.

**Error gate:** If `success` is `false`, display the `error` field to the user and STOP. Do not spawn any agents.

Save these fields for subsequent steps:
- `result.pipeline` - the pipeline config (null if single-agent mode)
- `result.builtPrompt` - the fallback single-agent prompt
- `result.agentType` - the fallback agent type
- `result.feedbackCommand` - the feedback command template
- `result.subCommand` - for display context
- `result.ticker` - for display context
- `trajectoryId` - for reference
- `isPipeline` - whether to use pipeline or single-agent mode

### Step 3: Execute Analysis

Check `isPipeline` to determine execution mode. **`isPipeline` is the authoritative flag.** If `isPipeline` is `true` but `result.pipeline` is `null`, treat as an error and STOP.

**Template substitution:** In all Agent() description strings below, replace `{ticker}` with `result.ticker`.

#### Mode A: Pipeline Execution (isPipeline === true AND result.pipeline is not null)

Orchestrate all 12 agents across 4 phases. Each agent receives its own `prompt` from the pipeline config. Use each agent's `key` field as the `subagent_type` parameter. Agents communicate via MemoryGraph -- Phase 1 writes data, Phase 2 reads data and writes analysis, Phase 3 reads analysis and writes composite, Phase 4 reads everything and writes the report.

**PHASE 1 -- Data Collection (parallel)**

Launch 3 Agent() calls simultaneously in a SINGLE message with multiple tool uses:

```
Agent(description="data-fetcher for {ticker}", subagent_type=pipeline.phases[0].agents[0].key, prompt=pipeline.phases[0].agents[0].prompt)
Agent(description="fundamentals-fetcher for {ticker}", subagent_type=pipeline.phases[0].agents[1].key, prompt=pipeline.phases[0].agents[1].prompt)
Agent(description="news-macro-fetcher for {ticker}", subagent_type=pipeline.phases[0].agents[2].key, prompt=pipeline.phases[0].agents[2].prompt)
```

Wait for all 3 to complete. An agent has "failed" if it returns an error message or produces no substantive output. If any fail: log a warning and continue -- downstream agents handle missing data gracefully.

**PHASE 2 -- Methodology Analysis (parallel)**

Launch 6 Agent() calls simultaneously in a SINGLE message:

```
Agent(description="wyckoff-analyzer for {ticker}", subagent_type=pipeline.phases[1].agents[0].key, prompt=pipeline.phases[1].agents[0].prompt)
Agent(description="elliott-wave-analyzer for {ticker}", subagent_type=pipeline.phases[1].agents[1].key, prompt=pipeline.phases[1].agents[1].prompt)
Agent(description="ict-analyzer for {ticker}", subagent_type=pipeline.phases[1].agents[2].key, prompt=pipeline.phases[1].agents[2].prompt)
Agent(description="canslim-analyzer for {ticker}", subagent_type=pipeline.phases[1].agents[3].key, prompt=pipeline.phases[1].agents[3].prompt)
Agent(description="williams-analyzer for {ticker}", subagent_type=pipeline.phases[1].agents[4].key, prompt=pipeline.phases[1].agents[4].prompt)
Agent(description="sentiment-analyzer for {ticker}", subagent_type=pipeline.phases[1].agents[5].key, prompt=pipeline.phases[1].agents[5].prompt)
```

Wait for all 6 to complete. If any fail: log a warning and proceed to Phase 3 with whatever results were written to MemoryGraph.

**PHASE 3 -- Aggregation (sequential)**

Launch 1 Agent() call:

```
Agent(description="composite-scorer for {ticker}", subagent_type=pipeline.phases[2].agents[0].key, prompt=pipeline.phases[2].agents[0].prompt)
```

Wait for completion before proceeding to Phase 4.

**PHASE 4 -- Output (sequential)**

Launch agents one at a time:

```
Agent(description="thesis-generator for {ticker}", subagent_type=pipeline.phases[3].agents[0].key, prompt=pipeline.phases[3].agents[0].prompt)
```

Wait for completion. Then:

```
Agent(description="report-formatter for {ticker}", subagent_type=pipeline.phases[3].agents[1].key, prompt=pipeline.phases[3].agents[1].prompt)
```

Wait for completion. The report-formatter's output is the final analysis report.

**Error Handling for Pipeline Mode:**
- An agent "fails" if it returns an error message, an empty response, or times out
- If ALL Phase 1 agents fail (no data written to MemoryGraph): abort pipeline, fall back to single-agent mode using `result.builtPrompt` and `result.agentType`
- If some Phase 2 agents fail: proceed to Phase 3 -- composite-scorer adjusts weights for missing signals
- If Phase 3 (composite-scorer) fails: present raw Phase 2 results to user, note incomplete aggregation
- If Phase 4 fails: present Phase 3 composite results directly, note missing formatted report

#### Single-Agent Execution (isPipeline === false, or pipeline fallback)

For scan/compare sub-commands OR as a fallback when the pipeline cannot execute, spawn exactly ONE Agent():

```
Agent(description="market-analysis {subCommand}", prompt=result.builtPrompt, subagent_type=result.agentType)
```

Pass `result.builtPrompt` VERBATIM. No modifications.

### Step 4: Present Output

**Pipeline mode**: Present the report-formatter's output as the final report, along with:
- Analysis mode (`result.subCommand`)
- Ticker analyzed (`result.ticker`)
- Number of phases completed (e.g., "4/4 phases")
- Number of agents that ran successfully
- Any agents that failed (with warnings)
- Trajectory ID for reference

**Single-agent mode**: Present the agent's output along with:
- Analysis mode (`result.subCommand`)
- Ticker(s) analyzed (`result.ticker`, `result.compareTicker` if compare mode)
- Methodology applied (`result.methodology`)
- Trajectory ID for reference

### Step 5: Provide Feedback (MANDATORY - Learning Loop Closure)

**CRITICAL - LEARNING LOOP CLOSURE**: After the Task() subagent returns, you MUST automatically submit quality feedback. This is NOT optional. Skipping this step causes orphaned trajectories that break the learning system.

### Programmatic Feedback Command

The CLI output includes `result.feedbackCommand` - a pre-built command with the correct trajectoryId. Use it directly, replacing `[quality_score]` with your assessed score (0.0-1.0):

```bash
# Replace [quality_score] with actual score (0.0-1.0)
${result.feedbackCommand}
```

### Quality Assessment Guidelines

| Score Range | Quality Level | Criteria |
|-------------|---------------|----------|
| **0.85-0.95** | Excellent | Comprehensive analysis, clear entry/exit levels, methodology properly applied, risk assessment included |
| **0.70-0.84** | Good | Solid analysis with actionable insights, minor gaps in methodology application |
| **0.50-0.69** | Adequate | Basic analysis performed, limited depth, few actionable recommendations |
| **0.30-0.49** | Poor | Superficial analysis, no actionable insights, methodology not applied |
| **0.00-0.29** | Failed | No meaningful analysis performed or completely off-topic |

### Orphan Detection

If the CLI output includes `orphanWarning`, there are orphaned trajectories from previous runs. Consider running:

```bash
npx tsx src/god-agent/universal/cli.ts auto-complete-coding
```

---

**DAI-002 Command Integration**: This command uses the universal CLI two-phase execution model. The CLI handles agent selection, DESC episode injection, and prompt construction. The skill file handles execution via Task() and learning loop closure via feedback.
