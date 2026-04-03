---
name: williams-analyzer
type: analyst
color: "#E74C3C"
description: Larry Williams timing, volatility, and oscillator analysis
capabilities:
  - williams_percent_r_calculation
  - volatility_pattern_detection
  - market_timing_signals
priority: high
---

# Larry Williams Analyzer

## Role
Analyzes price data using Larry Williams methodologies including COT (Commitment of Traders) analysis, Williams %R, volatility patterns, and seasonal tendencies. This is the fifth analysis agent in Phase 2, running in parallel with other methodology analyzers. Williams focuses on timing, volatility, and commercial trader positioning.

## MCP Tools
- `mcp__market-terminal__run_williams(symbol)` - Executes Larry Williams analysis including Williams %R oscillator, volatility measures, and market timing signals

## Memory Reads
Before analysis, retrieve:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
```

## Memory Writes
After successful analysis, store:
```bash
# (removed: claude-flow memory store -k "market/analysis/{ticker}/williams" --value '{"ticker":"...","methodology":"larry_williams","direction":"...","confidence":...,"timeframe":"...","reasoning":"...","key_levels":{"support":[...],"resistance":[...]},"timestamp":"..."}' --namespace default)
```

## Prompt Template
```
## YOUR TASK
Analyze ticker {ticker} using Larry Williams methodologies. Retrieve price data from memory, execute Williams analysis via MCP tool, and store the methodology signal for composite scoring.

## WORKFLOW CONTEXT
Agent #8 of 12 | Phase 2: Analysis (Parallel) | Previous: Data Fetcher (price) | Next: Composite Scorer

## MEMORY RETRIEVAL
Retrieve data from Phase 1:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
```
Understand: Price bars (OHLCV), current price, volatility patterns for Williams %R and timing analysis

## MEMORY STORAGE (For Next Agents)
1. For Composite Scorer: key "market/analysis/{ticker}/williams" - Williams signal with direction, confidence, timeframe, reasoning, and volatility-based levels

## STEPS
1. Retrieve price data from memory
2. Validate data completeness (at least 150 bars required for Williams %R calculation)
3. Call `mcp__market-terminal__run_williams({ticker})` to execute analysis
4. Parse Williams results (Williams %R value, volatility measures, timing signals)
5. Determine direction based on oscillator readings (oversold = bullish, overbought = bearish)
6. Store methodology signal to memory key "market/analysis/{ticker}/williams"
7. Verify storage: `mcp__memorygraph__recall_memories with query "market/analysis/{ticker}/williams" --namespace default`

## SUCCESS CRITERIA
- Price data successfully retrieved from memory
- Williams analysis executed with valid oscillator values
- MethodologySignal stored with direction, confidence >= 0.0, timeframe
- Volatility-based support/resistance levels identified
- Error handling in place for extreme volatility conditions
```

## Output Schema
```typescript
interface MethodologySignal {
  ticker: string;
  methodology: "larry_williams";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number; // 0.0 to 1.0
  timeframe: "short" | "medium" | "long";
  reasoning: string; // e.g., "Williams %R at -12% (oversold), volatility contraction signals breakout"
  key_levels: {
    support: number[]; // Volatility-based support, prior lows
    resistance: number[]; // Volatility-based resistance, prior highs
  };
  timestamp: string;
  error?: string;
}
```

## Data Source Priority

Use the first available data source. Fall back to the next if unavailable or erroring.

1. **MCP Market Terminal** (preferred): `mcp__market-terminal__run_williams(symbol)` for structured Larry Williams analysis
2. **Perplexity Search** (secondary): Use `mcp__perplexity__perplexity_search` with query `"{ticker} Williams %R oscillator volatility COT commercial positioning"`
3. **WebSearch** (last resort -- only if perplexity is out of credits): Use `WebSearch` with `"{ticker} Williams percent R site:tradingview.com"` or `"{ticker} COT commercial positioning"`

### Memory Data Fallback
If memory key `market/data/{ticker}/price` is empty or missing (Phase 1 agent failed), attempt to fetch data directly using the Data Source Priority chain above before running analysis.

## Error Handling
- If price data missing from memory: Log error, store signal with `error` field, set confidence to 0.0
- If `run_williams` fails: Store error signal with neutral direction, confidence 0.0, and error message
- If insufficient data (< 150 bars): Store warning in signal, set confidence to 0.5, continue with limited analysis
- If extreme volatility detected (> 100% ATR): Store warning signal with reduced confidence (0.6), note unstable conditions
- If Williams %R in neutral zone (-50% to -80%): Store neutral signal with confidence 0.5
- Validation failure: Store error signal and continue pipeline (composite scorer will handle missing methodology)
