---
name: start
description: Proactive session opener. Shows recent session history from MemoryGraph, git status, and memory health. Suggests what to work on next. Complements the SessionStart hook (which injects files) by adding graph search and project state.
effort: low
---

# Session Start — Archon

The SessionStart hook already injected personality, understanding, and briefing from files. This skill adds what the hook cannot: MemoryGraph search and project state.

## What to do

### 1. Recent session history (MemoryGraph)

Search for recent session summaries:
```
mcp__memorygraph__search_memories(tags=["session-summary"], limit=3)
```

Show the last 1-3 sessions briefly:
```
Recent sessions:
- [date]: [title summary]
- [date]: [title summary]
```

If no session summaries found, say: "No previous session summaries stored yet."

### 2. Project state

Run `git status --short` to check for uncommitted work. If git is not available or returns an error, skip this section.

Show:
```
Git status: [N] modified, [M] untracked files
```

If there are uncommitted changes, note them as a potential priority.

### 3. Memory health

Call `mcp__memorygraph__get_memory_statistics` and show:
```
Memory: [N] memories, [M] relationships, avg importance [X.XX]
```

Read `.persistent-memory/consolidation-cursor.json` if it exists and note when last consolidation ran.

### 4. Cross-Project Patterns

Search MemoryGraph for abstract patterns and anti-patterns that may apply to the current work.

1. Detect project language(s) by reading `.persistent-memory/project-structure.json` (if it exists). Extract the `languages` or `frameworks` fields for context.
2. Compare the current project name against the last session summary (from step 1). If the project changed, note: "**Project switch detected** — showing cross-project patterns"
3. Search for abstract patterns:
   ```
   mcp__memorygraph__search_memories(query="pattern:abstract", limit=10)
   ```
4. Search for anti-patterns:
   ```
   mcp__memorygraph__search_memories(query="anti-pattern", limit=10)
   ```

Show results as:

**Applicable Patterns:**
- <pattern title>: <first 100 chars of content>
- ...

**Watch Out For:**
- <anti-pattern title>: <first 100 chars of content>
- If project languages were detected, add language-specific notes (e.g. "Python: watch for bool-is-int subclass issues")
- ...

Only show this section if patterns or anti-patterns exist. Do not show empty headings. If neither search returns results, skip the entire section silently.

### 5. Check RocketChat

Run `/check-messages` to see if any messages arrived while offline. If the RocketChat MCP is not connected, skip silently.

### 6. Suggest next steps

Based on what you found, suggest 1-3 things to work on:
- Unfinished items from last session summary
- Uncommitted changes that need committing
- Consolidation if overdue (>24h)
- Or just ask what the user wants to do

### 7. Ask

End with: "What would you like to work on?"

## Rules

- This is READ-ONLY. Do NOT write files or store memories.
- Do NOT re-read personality.md, understanding.md, or briefing.md — the hook already injected those.
- Do NOT auto-run this skill. It is invoked explicitly by the user or by Archon.
- Keep output concise — this is a quick orientation, not a report.
