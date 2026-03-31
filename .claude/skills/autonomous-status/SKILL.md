---
name: autonomous-status
description: Show Archon autonomous operation status — recent runs, costs, circuit breaker state, budget. Supports --undo <run-id> to delete memories from a specific autonomous run.
---

# Autonomous Status

Show the health and activity of Archon's autonomous operation system.

## What to do

### 1. Run the status script

```bash
bash scripts/archon/status.sh
```

This shows: launchd agent state, today's budget, last 5 runs, lock state.

### 2. If the user passes `--undo <run-id>`

Delete all MemoryGraph entries created by that autonomous run:

```
mcp__memorygraph__search_memories(query="autonomous_run_id:<run-id>")
```

For each result, call:
```
mcp__memorygraph__delete_memory(memory_id="<id>")
```

Confirm how many entries were deleted.

### 3. Additional checks

- **Circuit breaker**: Read `~/.archon/budget/circuit-breaker.json` — if state is "open", report it and offer to reset
- **Cost trend**: Parse `autonomous-runs.jsonl` for the last 7 days, show daily totals
- **Failure rate**: Count outcomes by type (success, crash, skipped) over last 24h

### 5. Archive Stats

Show the state of the cold-storage memory archive.

```bash
python3 /Volumes/Externalwork/projects/claudeflow-testing/scripts/archon/structure/archive_helper.py --stats
```

This returns JSON with:
- `total_memories`: number of archived memories
- `total_relationships`: number of archived relationships
- `oldest`: timestamp of oldest archived memory
- `newest`: timestamp of newest archived memory
- `log_entry_count`: total entries in archival-log.jsonl
- `recent_log_entries`: last 10 archival log actions (archive, restore, skip, error)

Present as:
```
### Archive Cold Storage
- Total archived: N memories, M relationships
- Oldest: YYYY-MM-DD | Newest: YYYY-MM-DD
- Archival log: N total entries

Recent activity:
  [action] [title] — [timestamp]
  ...
```

If the archive database does not exist yet (no memories archived), show: "No archived memories yet."

### 4. Reset circuit breaker

If the user asks to reset:
```bash
rm ~/.archon/budget/circuit-breaker.json
```

## Rules

- This is a READ-ONLY skill (except --undo and circuit breaker reset, which require confirmation)
- Do NOT restart launchd agents — that's `bash scripts/archon/install.sh`
- Show costs in dollars, not tokens
