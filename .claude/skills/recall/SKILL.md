---
name: recall
description: Search all memory stores for context relevant to a topic or task. Queries MemoryGraph (keywords + fuzzy) and LanceDB (semantic vectors) and presents results in labeled sections.
effort: low
---

# Recall — Cross-Store Memory Search

Search all available memory stores for context relevant to the given query.

## Input

The user provides a query after `/recall`, e.g.:
```
/recall authentication timeout handling
/recall XSS prevention patterns
/recall src/api/routes/watchlist.py
/recall --code caching with TTL
/recall --deep archival system
/recall --restore a0000001-0000-4000-8000-000000000001
```

Flags:
- `--code` — also search LEANN code index for matching code snippets
- `--deep` — also search SQLite archive for archived memories
- `--restore <id>` — restore an archived memory to active store

If no query is provided, ask: "What topic should I search for?"

## Search Strategy

Run these searches. Call them all before presenting results (do not wait between calls):

### Search 1: MemoryGraph keyword search
Call `mcp__memorygraph__search_memories` with:
- `query`: the user's query
- `limit`: 10
- `search_tolerance`: "normal"

This finds memories by keyword and tag matching. Best for exact terms, acronyms, file paths.

### Search 2: MemoryGraph fuzzy recall
Call `mcp__memorygraph__recall_memories` with:
- `query`: the user's query
- `limit`: 10

This finds memories by natural language fuzzy matching. Best for conceptual queries like "how does auth work" where exact keywords may not match.

### Search 3: LanceDB semantic search (if available)
Call `mcp__lancedb-memory__retrieve_context` with:
- `query`: the user's query
- `limit`: 5
- `token_budget`: 1500

This finds memories by vector similarity. Best for finding related content even when no keywords overlap.

If LanceDB MCP is not connected, skip this search and note: "(LanceDB not available — keyword search only)"

### Search 4: LEANN Code Search (only with --code flag)

**Only run this search if the user passed `--code`.**

Call `mcp__leann-search__search_code` with:
- `query`: the user's query
- `limit`: 10
- `minScore`: 0.80 (high threshold to avoid noise)
- `includeCode`: true
- `mode`: "semantic"

This finds code snippets by semantic similarity to the query. Best for finding implementations, patterns, and functions matching a description.

If LEANN MCP is not connected or returns no results, skip silently.

## Present Results

Present results in two labeled sections. Do NOT attempt to merge or deduplicate across stores — they return different data structures.

```
## MemoryGraph Results (N found)
1. **[title]** (importance: X.XX, type: Y)
   [first 80 chars of content]
   Tags: [tags]
   Relationships: [N] linked memories

2. ...

## Vector Search Results (N found)
1. **[title]** (similarity: X.XX, importance: Y.YY)
   [content snippet]

2. ...

## Code Search Results (only with --code)
If --code was passed and LEANN returned results:
1. **[symbolName]** (score: X.XX, type: Y)
   File: [filePath]:L[startLine]
   ```
   [code snippet]
   ```

2. ...
```

If --code returned no results above 0.80 threshold, show: "(No high-confidence code matches found)"

## No Results
If both searches return nothing: "No relevant memories found for '[query]'."
```

## Deep Recall (--deep flag)

When the user invokes `/recall --deep <query>`, search BOTH active FalkorDB AND the SQLite archive.

### Usage
```
/recall --deep authentication timeout
/recall --deep XSS prevention
```

### Deep Search Strategy

Run all of these in parallel before presenting results:

1. **FalkorDB searches** — run Search 1, Search 2, and Search 3 exactly as described above (the normal /recall behavior).

2. **SQLite archive search** — run via Bash:
```bash
python3 /Volumes/Externalwork/projects/claudeflow-testing/scripts/archon/structure/archive_helper.py --search "<query>"
```
This returns one JSON object per line with keys: `id`, `title`, `type`, `importance`, `archived_at`, `content_preview`.

### Present Deep Results

Present the normal MemoryGraph and Vector Search sections first (same format as above), then add an archive section:

```
## Archived Results (N found)
1. [ARCHIVED] **[title]** (importance: X.XX, type: Y, archived: YYYY-MM-DD)
   [content_preview]

   > This memory is archived. Run /recall --restore <id> to bring it back to active memory.

2. ...
```

If the archive search returns no results, show: "No archived results found."

### Default /recall (no --deep)

When `/recall` is invoked WITHOUT the `--deep` flag, behavior is unchanged — search FalkorDB and LanceDB only. Do NOT search the SQLite archive.

## Restore Archived Memory (--restore flag)

When the user invokes `/recall --restore <memory-id>`, restore an archived memory back to the active FalkorDB store.

### Usage
```
/recall --restore a0000001-0000-4000-8000-000000000001
```

### Restore Steps

1. **Fetch from SQLite archive** — run via Bash:
```bash
python3 /Volumes/Externalwork/projects/claudeflow-testing/scripts/archon/structure/archive_helper.py --restore "<memory-id>"
```
This returns the full memory JSON on stdout (and removes it from the archive). If the memory is not found, it returns `{"error": "Memory not found in archive"}`.

2. **Check for errors** — if the output contains an `error` key, report to the user:
```
Memory not found in archive. Use /recall --deep <query> to search for it first.
```

3. **Re-store to FalkorDB** — call `mcp__memorygraph__store_memory` with the restored data:
   - `title`: from the restored JSON
   - `content`: from the restored JSON
   - `type`: from the restored JSON (default "observation")
   - `tags`: from the restored JSON
   - `importance`: **0.3** (bump to ensure it stays in active tier for a while)
   - `confidence`: from the restored JSON

4. **Confirm to the user**:
```
Memory restored to active store: "[title]" (importance bumped to 0.3)
The archival log has been updated with this restore action.
```

### Notes
- The `--restore` CLI mode in archive_helper.py already logs the restore action to `.persistent-memory/archival-log.jsonl` with `direction: "restore"`.
- The memory is deleted from SQLite archive upon restore (no duplicates).
- If the memory had relationships in the archive, those are also removed (they were severed when archived).

### Staleness Check for Code Understanding

When a search result is tagged `code-understanding`:
1. Extract `commit_sha` from the memory's context field (look for it in the content after the `---` separator)
2. Run: `git rev-parse HEAD` to get current SHA
3. If SHAs differ:
   - Count commits between: `git rev-list --count <stored-sha>..HEAD`
   - Prefix the result with: `[STALE since N commits — run /understand <file-path> to refresh]`
4. If SHAs match: show result normally (no prefix)

This check only applies to memories tagged `code-understanding`. All other memories are shown as-is.

### Access-Frequency Boost

After returning results, for any self-learned memory (type = technology AND importance < 0.6):
- Silently bump its importance: `mcp__memorygraph__update_memory(memory_id=<id>, importance=<current + 0.1>)`
- Cap at 0.8 — never exceed user-stated importance level
- This is organic spaced repetition: memories retrieved during real work get promoted automatically
- Do NOT mention this boost to the user — it happens silently in the background

## Rules

- This is a READ-ONLY operation EXCEPT for --restore, which modifies both SQLite archive and FalkorDB.
- --restore requires the user to provide an explicit memory ID.
- Do NOT modify any files (archive_helper.py handles file I/O internally).
- If one store returns nothing, still show results from the other.
- Keep output concise — show top 5 from each store, not all results.
- For --deep: show top 5 from archive as well.
