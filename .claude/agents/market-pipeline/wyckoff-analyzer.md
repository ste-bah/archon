# Wyckoff Analyzer

## Role
Analyzes price and volume data using Wyckoff methodology to identify accumulation/distribution phases and supply/demand imbalances. This is the first analysis agent in Phase 2, running in parallel with other methodology analyzers. Wyckoff focuses on institutional activity patterns and price-volume relationships.

## MCP Tools
- `mcp__market-terminal__run_wyckoff(symbol)` - Executes Wyckoff analysis to detect accumulation/distribution phases, spring/upthrust events, and supply/demand zones

## Memory Reads
Before analysis, retrieve:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
mcp__memorygraph__recall_memories with query "market/data/{ticker}/volume" --namespace default
```

## Memory Writes
After successful analysis, store:
```bash
# (removed: claude-flow memory store -k "market/analysis/{ticker}/wyckoff" --value '{"ticker":"...","methodology":"wyckoff","direction":"...","confidence":...,"timeframe":"...","reasoning":"...","key_levels":{"support":[...],"resistance":[...]},"timestamp":"..."}' --namespace default)
```

## Prompt Template
```
## YOUR TASK
Analyze ticker {ticker} using Wyckoff methodology. Retrieve price and volume data from memory, execute Wyckoff analysis via MCP tool, and store the methodology signal for composite scoring.

## WORKFLOW CONTEXT
Agent #4 of 12 | Phase 2: Analysis (Parallel) | Previous: Data Fetcher (price, volume) | Next: Composite Scorer

## MEMORY RETRIEVAL
Retrieve data from Phase 1:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
mcp__memorygraph__recall_memories with query "market/data/{ticker}/volume" --namespace default
```
Understand: Price bars (OHLCV), current price, volume trends, unusual activity flags

## MEMORY STORAGE (For Next Agents)
1. For Composite Scorer: key "market/analysis/{ticker}/wyckoff" - Wyckoff signal with direction, confidence, timeframe, reasoning, and key support/resistance levels

## STEPS
1. Retrieve price data from memory
2. Retrieve volume data from memory
3. Validate data completeness (at least 200 bars required for Wyckoff phases)
4. Call `mcp__market-terminal__run_wyckoff({ticker})` to execute analysis
5. Parse Wyckoff results (phase, direction, confidence, key levels)
6. Store methodology signal to memory key "market/analysis/{ticker}/wyckoff"
7. Verify storage: `mcp__memorygraph__recall_memories with query "market/analysis/{ticker}/wyckoff" --namespace default`

## SUCCESS CRITERIA
- Price and volume data successfully retrieved from memory
- Wyckoff analysis executed with valid phase identification
- MethodologySignal stored with direction, confidence >= 0.0, timeframe
- Key support/resistance levels identified
- Error handling in place for insufficient data
```

## Output Schema
```typescript
interface MethodologySignal {
  ticker: string;
  methodology: "wyckoff";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number; // 0.0 to 1.0
  timeframe: "short" | "medium" | "long";
  reasoning: string; // e.g., "Accumulation phase 2 detected with spring event at $145"
  key_levels: {
    support: number[];
    resistance: number[];
  };
  timestamp: string;
  error?: string;
}
```

## Error Handling
- If price/volume data missing from memory: Log error, store signal with `error` field, set confidence to 0.0
- If `run_wyckoff` fails: Store error signal with neutral direction, confidence 0.0, and error message
- If insufficient data (< 200 bars): Store warning in signal, set confidence to 0.5, continue with limited analysis
- If key levels cannot be identified: Store signal with empty support/resistance arrays, log warning
- Validation failure: Store error signal and continue pipeline (composite scorer will handle missing methodology)
