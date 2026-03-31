---
description: Store knowledge directly in the Universal Self-Learning God Agent
---

Store knowledge directly in the Universal Self-Learning God Agent for future retrieval. This allows you to:
1. Add facts, patterns, procedures, or insights
2. Tag knowledge for better retrieval
3. Build domain expertise manually
4. Prime the agent with important information

**Knowledge:** $ARGUMENTS

Execute the God Agent CLI to store knowledge:

```bash
npx tsx src/god-agent/universal/cli.ts learn "$ARGUMENTS"
```

**Options** (add to the command):
- `--domain patterns` - Domain namespace (default: "general")
- `--category pattern` - Category: fact, pattern, procedure, example, insight
- `--tags "design,factory"` - Comma-separated tags for filtering

**Examples:**
```bash
# Store a simple fact
npx tsx src/god-agent/universal/cli.ts learn "REST APIs should use proper HTTP status codes"

# Store with metadata
npx tsx src/god-agent/universal/cli.ts learn "Factory pattern enables flexible object creation" --domain patterns --category pattern --tags "design,factory,creational"

# Store from a file
npx tsx src/god-agent/universal/cli.ts learn --file ./docs/learnings.md --domain "project/docs" --category fact
```

The knowledge will be:
- **Automatically chunked** if content exceeds 2000 characters (OpenAI 8191 token limit compliance)
- Embedded into the vector database (each chunk gets its own embedding)
- Tagged for retrieval (auto-extracted or specified)
- Available for future queries (chunks are reconstructed on retrieval)
- Contributing to domain expertise

**Large Content Handling (Sprint 13):**
- Content > 2000 chars is automatically split using SymmetricChunker
- Each chunk maintains parent reference for reconstruction
- Semantic boundaries (code blocks, tables) are preserved
- Content-aware token estimation (code=1.5x, tables=2.0x, prose=1.3x)
- Chunks < 200 chars are merged with adjacent chunks

**Query stored knowledge:**
```bash
npx tsx src/god-agent/universal/cli.ts query --domain "patterns" --tags "factory" --limit 5
```
