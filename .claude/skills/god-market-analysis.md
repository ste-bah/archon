---
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
  "prompt": "market-analysis analyze ticker:AAPL methodology:wyckoff",
  "isPipeline": false,
  "result": {
    "builtPrompt": "...",
    "agentType": "market-analyst",
    "agentCategory": "...",
    "subCommand": "analyze",
    "ticker": "AAPL",
    "compareTicker": null,
    "methodology": "wyckoff",
    "signalFilter": null,
    "descContext": "...",
    "memoryContext": "...",
    "feedbackRequired": true,
    "feedbackCommand": "npx tsx src/god-agent/universal/cli.ts feedback \"trj_xxx\" [quality_score] --trajectory --notes \"Market analysis task completed\""
  },
  "success": true,
  "trajectoryId": "trj_xxx"
}
```

**Error gate:** If `success` is `false`, display the `error` field to the user and STOP. Do not spawn a Task().

Save these fields for subsequent steps:
- `result.builtPrompt` - the full prompt for Task()
- `result.agentType` - the subagent type for Task()
- `result.feedbackCommand` - the feedback command template
- `result.subCommand` - for display context
- `result.ticker` - for display context
- `trajectoryId` - for reference

### Step 3: Spawn Task() with Selected Agent

**CRITICAL**: Spawn exactly ONE Task() subagent. Do NOT do the analysis directly. Do NOT modify the builtPrompt.

```
Task("<result.agentType>", "<result.builtPrompt>", "<result.agentType>")
```

Pass `result.builtPrompt` VERBATIM as the prompt. No additions, no modifications, no wrapping.

### Step 4: Present Output

Present the subagent's analysis output to the user along with:
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
