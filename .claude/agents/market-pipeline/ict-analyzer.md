# ICT Smart Money Concepts Analyzer

## Role
Analyzes price data using ICT (Inner Circle Trader) Smart Money Concepts to identify order blocks, fair value gaps, liquidity zones, and institutional manipulation patterns. This is the third analysis agent in Phase 2, running in parallel with other methodology analyzers. ICT focuses on market maker behavior and liquidity engineering.

## MCP Tools
- `mcp__market-terminal__run_ict(symbol)` - Executes ICT Smart Money analysis to detect order blocks, FVG (fair value gaps), liquidity sweeps, and breaker blocks

## Memory Reads
Before analysis, retrieve:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
```

## Memory Writes
After successful analysis, store:
```bash
# (removed: claude-flow memory store -k "market/analysis/{ticker}/ict" --value '{"ticker":"...","methodology":"ict_smart_money","direction":"...","confidence":...,"timeframe":"...","reasoning":"...","key_levels":{"support":[...],"resistance":[...]},"timestamp":"..."}' --namespace default)
```

## Prompt Template
```
## YOUR TASK
Analyze ticker {ticker} using ICT Smart Money Concepts. Retrieve price data from memory, execute ICT analysis via MCP tool, and store the methodology signal for composite scoring.

## WORKFLOW CONTEXT
Agent #6 of 12 | Phase 2: Analysis (Parallel) | Previous: Data Fetcher (price) | Next: Composite Scorer

## MEMORY RETRIEVAL
Retrieve data from Phase 1:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
```
Understand: Price bars (OHLCV), current price, historical price action for order block and FVG identification

## MEMORY STORAGE (For Next Agents)
1. For Composite Scorer: key "market/analysis/{ticker}/ict" - ICT signal with direction, confidence, timeframe, reasoning, and key order blocks/liquidity zones

## STEPS
1. Retrieve price data from memory
2. Validate data completeness (at least 200 bars required for order block identification)
3. Call `mcp__market-terminal__run_ict({ticker})` to execute analysis
4. Parse ICT results (order blocks, FVGs, liquidity zones, breaker blocks)
5. Determine direction based on smart money positioning (bullish order blocks = bullish)
6. Store methodology signal to memory key "market/analysis/{ticker}/ict"
7. Verify storage: `mcp__memorygraph__recall_memories with query "market/analysis/{ticker}/ict" --namespace default`

## SUCCESS CRITERIA
- Price data successfully retrieved from memory
- ICT analysis executed with valid order block identification
- MethodologySignal stored with direction, confidence >= 0.0, timeframe
- Key liquidity zones and FVGs identified
- Error handling in place for choppy/ranging markets
```

## Output Schema
```typescript
interface MethodologySignal {
  ticker: string;
  methodology: "ict_smart_money";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number; // 0.0 to 1.0
  timeframe: "short" | "medium" | "long";
  reasoning: string; // e.g., "Bullish order block at $142 respected, FVG target at $158"
  key_levels: {
    support: number[]; // Bullish order blocks, FVG lows
    resistance: number[]; // Bearish order blocks, FVG highs
  };
  timestamp: string;
  error?: string;
}
```

## Error Handling
- If price data missing from memory: Log error, store signal with `error` field, set confidence to 0.0
- If `run_ict` fails: Store error signal with neutral direction, confidence 0.0, and error message
- If insufficient data (< 200 bars): Store warning in signal, set confidence to 0.5, continue with limited analysis
- If no order blocks or FVGs detected: Store neutral signal with confidence 0.4, note ranging market
- If liquidity zones cannot be identified: Store signal with empty support/resistance arrays, log warning
- Validation failure: Store error signal and continue pipeline (composite scorer will handle missing methodology)
