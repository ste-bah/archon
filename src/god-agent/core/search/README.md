# Web Search Module

Provides web search capabilities for God Agent research operations using a hybrid approach.

## Architecture

```
UniversalAgent.performWebSearch()
    ↓
HybridSearchProvider.search()
    ↓
┌────────────────────────────────────┐
│  Depth-Based Tool Selection        │
├────────────────────────────────────┤
│  quick  → WebSearch (native)       │
│  medium → perplexity_ask (MCP)     │
│  deep   → perplexity_research (MCP)│
└────────────────────────────────────┘
    ↓
Returns structured invocation instructions
```

## Usage

### From UniversalAgent

```typescript
import { UniversalAgent } from '../universal';

const agent = new UniversalAgent({ enableWebSearch: true });
await agent.initialize();

// Research automatically uses web search
const result = await agent.research({
  query: 'Latest AI developments',
  depth: 'deep'
});
```

### Direct Provider Usage

```typescript
import { HybridSearchProvider } from './search';

const provider = new HybridSearchProvider({ verbose: true });

const results = await provider.search('TypeScript best practices', {
  depth: 'quick',
  maxResults: 10
});

console.log(results[0].content); // Tool invocation instructions
```

## Provider Interface

### IWebSearchProvider

```typescript
interface IWebSearchProvider {
  search(query: string, options: ISearchOptions): Promise<ISearchResult[]>;
  getAvailableSources(): string[];
  isAvailable(): Promise<boolean>;
}
```

### Search Options

```typescript
interface ISearchOptions {
  depth: 'quick' | 'medium' | 'deep';  // Search depth
  maxResults?: number;                  // Max results (default: 10)
  recency?: 'day' | 'week' | 'month' | 'year' | 'all';
  domains?: string[];                   // Domain restrictions
}
```

### Search Results

```typescript
interface ISearchResult {
  content: string;      // Main content/snippet
  source: string;       // Source identifier
  url?: string;         // Optional URL
  relevance: number;    // Relevance score (0-1)
  timestamp?: Date;     // Retrieval timestamp
  citations?: string[]; // References/citations
}
```

## Depth Levels

| Depth | Tool | Latency | Best For |
|-------|------|---------|----------|
| quick | Native WebSearch | ~1s | Quick facts, simple queries |
| medium | perplexity_ask | ~3s | Conversational queries |
| deep | perplexity_research | ~10s | Comprehensive research |

## Design Rationale

### Why Hybrid Approach?

1. **Performance**: Quick queries use native WebSearch (no MCP overhead)
2. **Quality**: Deep research uses Perplexity Research (comprehensive)
3. **Flexibility**: Easy to add more providers
4. **Cost**: Balances free (native) vs paid (Perplexity) usage

### Why Not Direct MCP Invocation?

MCP tools are designed for LLM orchestration, not TypeScript runtime:
- Proper context/state management
- Tool selection by LLM
- Security boundaries
- Future MCP client integration

The provider returns **structured instructions** for tool invocation, which the orchestrating agent (Claude Code) can use to invoke the appropriate MCP tool.

## Future Enhancements

### MCP Client Integration

```typescript
// When MCP client library is available
const mcpClient = new McpClient(config);
const provider = new HybridSearchProvider({ mcpClient });

// Direct tool invocation
const results = await provider.search(query, { depth: 'deep' });
// Results now contain actual search data, not instructions
```

### Additional Providers

```typescript
// Pluggable providers
const customProvider = new CustomSearchProvider();
const agent = new UniversalAgent({
  webSearchProvider: customProvider
});
```

## Memory Integration

All search operations automatically store results in InteractionStore:

```typescript
// Storage domain
domain: 'research/searches'

// Storage category
category: 'web-search'

// Tags
tags: ['web-search', depth, 'auto-stored']

// Retrieve search history
const searches = agent.interactionStore.getKnowledgeByDomain('research/searches');
```

## Error Handling

```typescript
try {
  const results = await provider.search(query, options);
} catch (error) {
  // Graceful fallback
  return [{
    content: `Search failed: ${error}`,
    source: 'error',
    relevance: 0,
    confidence: 0
  }];
}
```

## Testing

### Unit Tests (Template)

```typescript
describe('HybridSearchProvider', () => {
  it('should select correct tool for depth', () => {
    const provider = new HybridSearchProvider();

    // Test tool selection logic
    const quickTool = provider.selectToolForDepth('query', { depth: 'quick' });
    expect(quickTool.tool).toBe('WebSearch');

    const deepTool = provider.selectToolForDepth('query', { depth: 'deep' });
    expect(deepTool.tool).toBe('mcp__perplexity__perplexity_research');
  });
});
```

### Integration Tests (Template)

```typescript
describe('UniversalAgent Web Search', () => {
  it('should perform research with web search', async () => {
    const agent = new UniversalAgent({ enableWebSearch: true });
    await agent.initialize();

    const result = await agent.research({
      query: 'TypeScript 5.0 features',
      depth: 'quick'
    });

    expect(result.findings.length).toBeGreaterThan(0);
  });
});
```

## Configuration

### Environment Variables

No new environment variables required. Perplexity MCP is configured in `.mcp.json`:

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity/mcp-server"],
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
      }
    }
  }
}
```

### Agent Configuration

```typescript
const agent = new UniversalAgent({
  enableWebSearch: true,  // Enable web search (default: true)
  verbose: true           // Log search operations
});
```

## Related Specs

- **SPEC-WEB-001**: Real Web Search via Hybrid Provider
- **SPEC-EMB-002**: Real Embedding Provider (for semantic search)
- **SPEC-RSN-002**: Advanced Reasoning Modes (uses web search)

## Files

```
src/god-agent/core/search/
├── web-search-provider.ts    (Interface definitions)
├── hybrid-search-provider.ts (Hybrid implementation)
├── index.ts                  (Exports)
└── README.md                 (This file)
```

## Support

For issues or questions:
1. Check specification: `docs/god-agent-specs/SPEC-WEB-001-REAL-WEB-SEARCH.md`
2. Review implementation: `docs/SPEC-WEB-001-IMPLEMENTATION-COMPLETE.md`
3. Consult code comments in `hybrid-search-provider.ts`
