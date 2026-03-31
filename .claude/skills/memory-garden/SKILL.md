---
name: memory-garden
description: Interactive memory consolidation, inspection, and maintenance. Run consolidation stages, inspect memory health, regenerate briefings, and reconcile stores.
---

# Memory Garden — Consolidation & Maintenance

You are running the memory garden maintenance cycle. Follow these steps exactly.

## Step 1: Show Memory Stats

Call `mcp__memorygraph__get_memory_statistics` and display:
- Total memories by type
- Total relationships
- Average importance

## Step 2: Identify Issues

Search for problems:
- Call `mcp__memorygraph__search_memories` with `min_importance: 0` and check for memories with importance < 0.1 (archival candidates)
- Note any memories older than 30 days with zero relationships (orphans)

## Step 3: Present Menu

Show this menu and ask the user to choose:

```
Memory Garden Actions:
  a) Run full consolidation (all 5 stages)
  b) Decay only (Stage 1 — reduce importance on old memories)
  c) Find and merge duplicates (Stages 2+3)
  d) Discover relationships (Stage 4)
  e) Regenerate briefing (Stage 5)
  f) Show consolidation cursor state
  g) Reconcile MemoryGraph vs LanceDB
  h) Drain pending-embeddings queue
```

## Step 4: Execute Chosen Action

### Option a — Full Consolidation
Run all 5 stages sequentially. Report after each stage.

### Option b — Stage 1: Importance Decay

For each memory type, apply exponential decay based on days since last update:

| Type | Half-life |
|------|-----------|
| code_pattern, solution, fix | 30 days |
| project, technology | 60 days |
| error, problem | 14 days |
| task, workflow, command, general, conversation, file_context | 7 days |

Formula: `new_importance = current_importance * exp(-days_since_update / half_life)`

Process:
1. Call `mcp__memorygraph__search_memories` with limit 50
2. For each memory, calculate days since update
3. Apply decay formula
4. If new_importance differs by > 0.01, call `mcp__memorygraph__update_memory` with the new importance
5. If new_importance < 0.05, reduce to 0.01 (archived, not deleted)
6. Report: "Stage 1 complete. Updated N memories. Archived M."

### Option c — Stages 2+3: Duplicate Detection + Merging

Stage 2 — Find duplicates:
1. Call `mcp__memorygraph__search_memories` with limit 100
2. Compare every pair of titles using word overlap (Jaccard similarity)
3. Flag pairs with > 50% word overlap as candidates

Stage 3 — Merge duplicates:
For each candidate pair:
1. Keep the memory with higher importance
2. Append unique content from the lower-importance memory
3. Merge tags (union)
4. Update the kept memory via `mcp__memorygraph__update_memory`
5. Set the donor memory importance to 0.01 (archived)
6. Report: "Stages 2+3 complete. Found N pairs. Merged M."

### Option d — Stage 4: Relationship Discovery

1. Call `mcp__memorygraph__search_memories` with limit 100
2. Group memories by shared tags
3. For each pair sharing 2+ tags that aren't already linked:
   - Call `mcp__memorygraph__create_relationship` with type RELATED_TO
4. Report: "Stage 4 complete. Created N relationships."

### Option e — Stage 5: Regenerate Briefing

1. Call `mcp__memorygraph__search_memories` with `min_importance: 0.5`, sorted by importance
2. Take top 10 results
3. Format as markdown briefing
4. Write to `.persistent-memory/briefing.md`:

```markdown
# Memory Briefing (auto-generated)
Generated: [ISO timestamp]

## Key Memories
- **[title]** (importance: X.XX, type: Y): [first 100 chars of content]
- ...
```

5. Report: "Stage 5 complete. Briefing generated with N memories."

### Option f — Show Cursor

Read `.persistent-memory/consolidation-cursor.json` and display its contents. If it doesn't exist, say "No consolidation cursor found. Run a consolidation to create one."

### Option g — Reconcile

1. Call `mcp__memorygraph__get_memory_statistics` for MemoryGraph count
2. Call `mcp__lancedb_memory__reconcile` for LanceDB IDs (if available)
3. Compare counts and report discrepancies
4. If LanceDB is not available, report "LanceDB MCP not connected. Only MemoryGraph stats available."

### Option h — Drain Queue

1. Call `mcp__lancedb_memory__drain_queue` (if available)
2. Report results: processed, failed, remaining
3. If LanceDB is not available, check if `.persistent-memory/pending-embeddings.json` exists and report its size

## Step 5: Update Cursor

After any action, write the cursor state to `.persistent-memory/consolidation-cursor.json`:
```json
{
  "lastStage": "stage-N",
  "lastRun": "ISO timestamp",
  "cycleCount": N,
  "memoriesProcessed": N,
  "memoriesUpdated": N
}
```

## Anti-Patterns (NEVER DO THESE)
- Do NOT create memories about the memory system itself
- Do NOT modify CLAUDE.md
- Do NOT delete memories — archive by setting importance to 0.01
- Do NOT merge memories from different projects unless they share 3+ tags
- Do NOT run more than 50 memories per stage per invocation
