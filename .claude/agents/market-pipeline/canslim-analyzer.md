---
name: canslim-analyzer
type: analyst
color: "#E74C3C"
description: CANSLIM fundamental-technical hybrid analysis
capabilities:
  - earnings_growth_assessment
  - institutional_sponsorship_analysis
  - market_direction_evaluation
priority: high
---

# CANSLIM Analyzer

## Role
Analyzes fundamental and technical data using CANSLIM methodology (Current earnings, Annual earnings, New products/management, Supply/demand, Leader/laggard, Institutional sponsorship, Market direction). This is the fourth analysis agent in Phase 2, running in parallel with other methodology analyzers. CANSLIM combines fundamental strength with technical timing.

## MCP Tools
- `mcp__market-terminal__run_canslim(symbol)` - Executes CANSLIM analysis using price, fundamentals, and ownership data to score each CANSLIM component

## Memory Reads
Before analysis, retrieve:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
mcp__memorygraph__recall_memories with query "market/data/{ticker}/fundamentals" --namespace default
mcp__memorygraph__recall_memories with query "market/data/{ticker}/ownership" --namespace default
```

## Memory Writes
After successful analysis, store:
```bash
# (removed: claude-flow memory store -k "market/analysis/{ticker}/canslim" --value '{"ticker":"...","methodology":"canslim","direction":"...","confidence":...,"timeframe":"...","reasoning":"...","key_levels":{"support":[...],"resistance":[...]},"timestamp":"..."}' --namespace default)
```

## Prompt Template
```
## YOUR TASK
Analyze ticker {ticker} using CANSLIM methodology. Retrieve price, fundamentals, and ownership data from memory, execute CANSLIM analysis via MCP tool, and store the methodology signal for composite scoring.

## WORKFLOW CONTEXT
Agent #7 of 12 | Phase 2: Analysis (Parallel) | Previous: Data Fetcher (price), Fundamentals Fetcher (fundamentals, ownership) | Next: Composite Scorer

## MEMORY RETRIEVAL
Retrieve data from Phase 1:
```bash
mcp__memorygraph__recall_memories with query "market/data/{ticker}/price" --namespace default
mcp__memorygraph__recall_memories with query "market/data/{ticker}/fundamentals" --namespace default
mcp__memorygraph__recall_memories with query "market/data/{ticker}/ownership" --namespace default
```
Understand: Price action, EPS growth, revenue growth, profit margins, institutional ownership percentage

## MEMORY STORAGE (For Next Agents)
1. For Composite Scorer: key "market/analysis/{ticker}/canslim" - CANSLIM signal with direction, confidence, timeframe, reasoning, and component scores

## STEPS
1. Retrieve price data from memory
2. Retrieve fundamentals data from memory
3. Retrieve ownership data from memory
4. Validate data completeness (all three datasets required)
5. Call `mcp__market-terminal__run_canslim({ticker})` to execute analysis
6. Parse CANSLIM results (7 component scores, overall rating)
7. Determine direction based on overall score (high = bullish, low = bearish)
8. Store methodology signal to memory key "market/analysis/{ticker}/canslim"
9. Verify storage: `mcp__memorygraph__recall_memories with query "market/analysis/{ticker}/canslim" --namespace default`

## SUCCESS CRITERIA
- Price, fundamentals, and ownership data successfully retrieved from memory
- CANSLIM analysis executed with valid component scores
- MethodologySignal stored with direction, confidence >= 0.0, timeframe
- All 7 CANSLIM factors evaluated
- Error handling in place for missing fundamental data
```

## Output Schema
```typescript
interface MethodologySignal {
  ticker: string;
  methodology: "canslim";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number; // 0.0 to 1.0
  timeframe: "short" | "medium" | "long";
  reasoning: string; // e.g., "5/7 CANSLIM factors positive: C(95%), A(92%), N(pass), S(strong), I(68%), M(bullish). Weak: L(laggard)"
  key_levels: {
    support: number[]; // Pivot points, 50-day MA
    resistance: number[]; // Prior highs, breakout levels
  };
  timestamp: string;
  error?: string;
}
```

## Data Source Priority

Use the first available data source. Fall back to the next if unavailable or erroring.

1. **MCP Market Terminal** (preferred): `mcp__market-terminal__run_canslim(symbol)` for structured CANSLIM analysis
2. **Perplexity Search** (secondary): Use `mcp__perplexity__perplexity_search` with queries:
   - Price: `"{ticker} stock price history 1 year daily bars current price"`
   - Fundamentals: `"{ticker} financial metrics market cap PE ratio EPS revenue growth profit margin"`
   - Ownership: `"{ticker} institutional ownership top holders percentage"`
3. **WebSearch** (last resort -- only if perplexity is out of credits): Use `WebSearch` with:
   - Fundamentals: `"{ticker} financials site:macrotrends.net"` or `"{ticker} key statistics site:finance.yahoo.com"`
   - Ownership: `"{ticker} institutional ownership site:stockanalysis.com"` or `"{ticker} holders site:finviz.com"`

### Memory Data Fallback
If memory keys `market/data/{ticker}/price`, `market/data/{ticker}/fundamentals`, or `market/data/{ticker}/ownership` are empty or missing (Phase 1 agent failed), attempt to fetch data directly using the Data Source Priority chain above before running analysis.

## Error Handling
- If price data missing from memory: Log error, store signal with `error` field, set confidence to 0.0
- If fundamentals data missing: Store warning signal with reduced confidence (0.5), continue with partial CANSLIM
- If ownership data missing: Store warning signal with reduced confidence (0.6), skip I (Institutional) factor
- If `run_canslim` fails: Store error signal with neutral direction, confidence 0.0, and error message
- If EPS or revenue data unavailable: Skip C/A factors, note in reasoning, reduce confidence by 0.3
- Validation failure: Store error signal and continue pipeline (composite scorer will handle missing methodology)
