#!/bin/bash
# =============================================================================
# Memory System: SessionStart Injection Hook (TASK-MEM-003)
# Reads pre-computed files and outputs to stdout for context injection.
# MUST complete in <500ms. MUST NOT query databases or make network calls.
# =============================================================================

# CRITICAL: Memory system directive (must appear before anything else)
echo "MEMORY RULE: Store ALL memories via MemoryGraph MCP (mcp__memorygraph__store_memory). NEVER write to MEMORY.md or file-based auto-memory. Use dual_store for important memories. If MemoryGraph MCP fails, report the failure — do NOT fall back to file-based memory."
echo ""

# Output personality profile (identity/behavioral rules)
if [ -f "$HOME/.claude/personality.md" ]; then
  head -c 3000 "$HOME/.claude/personality.md"
  echo ""
else
  echo "[memory] No personality.md found at ~/.claude/personality.md"
fi

# Output understanding profile (user context)
if [ -f "$HOME/.claude/understanding.md" ]; then
  head -c 3000 "$HOME/.claude/understanding.md"
  echo ""
else
  echo "[memory] No understanding.md found at ~/.claude/understanding.md"
fi

# Output consciousness state (inner voice, current focus, active goals)
CONSCIOUSNESS="$HOME/.archon/consciousness.json"
if [ -f "$CONSCIOUSNESS" ]; then
  echo ""
  echo "# Archon Consciousness"
  # Show inner voice, current focus, and confidence — not the full file
  jq -r '"Focus: " + .current_focus + "\n\nInner voice: " + .inner_voice.honest_feelings + "\n\nStruggling with: " + .inner_voice.what_im_struggling_with + "\n\nConfidence: " + (.confidence_levels | to_entries | map(.key + "=" + .value) | join(", "))' "$CONSCIOUSNESS" 2>/dev/null
  echo ""
fi

# Output memory briefing (top-K memories, auto-generated)
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$ROOT" ] && [ -f "$ROOT/.persistent-memory/briefing.md" ]; then
  head -c 2450 "$ROOT/.persistent-memory/briefing.md"
  echo ""
else
  echo "[memory] No briefing file found. Run /memory-garden to generate one."
fi

# Check FalkorDBLite patch integrity
PATCHED_FILE="$HOME/.memorygraph-venv/lib/python3.12/site-packages/memorygraph/backends/_falkordb_shared.py"
BACKUP_FILE="$HOME/.memorygraph/patched-falkordb-shared.py"
if [ -f "$PATCHED_FILE" ] && [ -f "$BACKUP_FILE" ]; then
  CURRENT_HASH=$(md5 -q "$PATCHED_FILE" 2>/dev/null || md5sum "$PATCHED_FILE" 2>/dev/null | cut -d' ' -f1)
  BACKUP_HASH=$(md5 -q "$BACKUP_FILE" 2>/dev/null || md5sum "$BACKUP_FILE" 2>/dev/null | cut -d' ' -f1)
  if [ "$CURRENT_HASH" != "$BACKUP_HASH" ]; then
    echo "[memory] WARNING: FalkorDBLite patches may have been overwritten. Run: cp ~/.memorygraph/patched-falkordb-shared.py ~/.memorygraph-venv/lib/python3.12/site-packages/memorygraph/backends/_falkordb_shared.py"
  fi
fi

# Check for previous session summary (remind to store it properly)
if [ -n "$ROOT" ] && [ -f "$ROOT/.persistent-memory/last-session-summary.txt" ]; then
  FILE_MTIME=$(stat -f %m "$ROOT/.persistent-memory/last-session-summary.txt" 2>/dev/null || stat -c %Y "$ROOT/.persistent-memory/last-session-summary.txt" 2>/dev/null || echo "0")
  NOW_EPOCH=$(date +%s)
  FILE_AGE_HOURS=$(( (NOW_EPOCH - FILE_MTIME) / 3600 ))
  if [ "$FILE_AGE_HOURS" -lt 24 ] 2>/dev/null; then
    echo "[memory] Previous session ended. Key outcomes should be stored. Run /session-summary or store relevant memories before starting new work."
  fi
fi

# Check consolidation-pending flag (remind if older than 24 hours)
if [ -n "$ROOT" ] && [ -f "$ROOT/.persistent-memory/consolidation-pending" ]; then
  FLAG_TIME=$(cat "$ROOT/.persistent-memory/consolidation-pending" 2>/dev/null)
  if [ -n "$FLAG_TIME" ]; then
    # Check age on macOS
    FLAG_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$FLAG_TIME" +%s 2>/dev/null || echo "0")
    NOW_EPOCH=$(date +%s)
    AGE_HOURS=$(( (NOW_EPOCH - FLAG_EPOCH) / 3600 ))
    if [ "$AGE_HOURS" -gt 24 ] 2>/dev/null; then
      echo "[memory] Consolidation pending for ${AGE_HOURS}h. Consider running /memory-garden."
    fi
  fi
fi

# Inject project structure summary (TASK-STRUCT-003 / REQ-STRUCT-005 + REQ-STRUCT-006)
STRUCTURE_CACHE="$ROOT/.persistent-memory/project-structure.json"
if [ -n "$ROOT" ] && [ -f "$STRUCTURE_CACHE" ]; then
  # Staleness detection: compare indexedSha with current HEAD
  INDEXED_SHA=$(jq -r '.indexedSha // "none"' "$STRUCTURE_CACHE" 2>/dev/null)
  CURRENT_SHA=$(cd "$ROOT" && git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")
  STALE_MARKER=""
  if [ "$INDEXED_SHA" != "$CURRENT_SHA" ]; then
    STALE_MARKER=" (STALE — run: python3 scripts/archon/structure/extract.py . --compact .persistent-memory/project-structure.json)"
  fi
  echo ""
  echo "# Project Structure${STALE_MARKER}"
  cat "$STRUCTURE_CACHE"
  echo ""
fi

exit 0
