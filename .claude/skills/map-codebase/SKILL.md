---
name: map-codebase
description: Extract and cache project structure using Python ast. Regenerates the compact summary injected at SessionStart. Use when the structure summary shows as STALE or after major refactoring.
---

# Map Codebase

Re-extract project structure and update the cached summary for SessionStart injection.

## What to do

### 1. Run the structure extractor

```bash
python3 scripts/archon/structure/extract.py <project-root> \
  --compact .persistent-memory/project-structure.json \
  --output /tmp/structure-full.json
```

For Market Terminal backend:
```bash
python3 scripts/archon/structure/extract.py market-terminal/backend \
  --compact .persistent-memory/project-structure.json
```

### 2. Show results

Report:
- File count and total symbols extracted
- Extraction time
- Compact summary size (should be < 3KB)
- Whether the indexedSha matches current HEAD (should now be fresh)

### 3. Optionally store to MemoryGraph

If the user wants persistent graph storage (not just the cached JSON):
```
mcp__memorygraph__store_memory(
  type="project",
  title="Project Structure: <project-name>",
  content="<compact summary JSON>",
  tags=["structure", "project", "<project-name>"],
  importance=0.7
)
```

## When to use

- SessionStart injection shows "(STALE)" marker
- After creating many new files or reorganizing directories
- When starting work on a new project for the first time
- Periodically (weekly) to keep the summary fresh

## Rules

- Only extracts Python files currently. TypeScript support is Phase 2.
- The compact summary is the primary output — it's what gets injected at SessionStart.
- The full output (--output) goes to /tmp for inspection, not persisted.
- Does NOT modify any source code — read-only extraction.
