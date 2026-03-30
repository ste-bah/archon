#!/bin/bash
# =============================================================================
# Archon Personality: SessionStart Hook (v2 consciousness)
# Reads personality data from LOCAL CACHE FILES (primary, fast, reliable).
# Falls back to MemoryGraph queries only if cache doesn't exist.
# Session isolation via $PPID — no shared files, no race conditions.
# =============================================================================

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0

PM_DIR="$ROOT/.persistent-memory"
SID="$PPID"
SESSION_DIR="$PM_DIR/sessions/$SID"

# Create session directory
mkdir -p "$SESSION_DIR"

# Clean stale session directories (>2 hours old, from crashed sessions)
find "$PM_DIR/sessions" -mindepth 1 -maxdepth 1 -type d -mmin +120 -exec rm -rf {} \; 2>/dev/null || true

# Start singleton daemon if not running
if [ -x "$ROOT/scripts/archon/personality-daemon-start.sh" ]; then
  "$ROOT/scripts/archon/personality-daemon-start.sh" 2>/dev/null
fi

# ── Read from local cache files (primary — fast, no Python needed) ────

SESSION_DATA="$PM_DIR/personality-session-data.json"

if [ -f "$SESSION_DATA" ] && command -v jq &>/dev/null; then
  GRADE=$(jq -r '.trust_grade // "?"' "$SESSION_DATA" 2>/dev/null)
  MOOD_VAL=$(jq -r '.mood_valence // 0' "$SESSION_DATA" 2>/dev/null)
  NARRATIVE=$(jq -r '.narrative // ""' "$SESSION_DATA" 2>/dev/null)
  SESSION_COUNT=$(jq -r '.session_count // 0' "$SESSION_DATA" 2>/dev/null)
  TRAITS=$(jq -r '
    .trait_means // {} | to_entries | sort_by(-.value) | .[0:3]
    | map(.key + "=" + (.value | tostring | .[0:4]))
    | join(", ")
  ' "$SESSION_DATA" 2>/dev/null)

  MOOD_WORD="neutral"
  if [ "$(echo "$MOOD_VAL > 0.2" | bc -l 2>/dev/null)" = "1" ]; then
    MOOD_WORD="positive"
  elif [ "$(echo "$MOOD_VAL < -0.2" | bc -l 2>/dev/null)" = "1" ]; then
    MOOD_WORD="negative"
  fi

  echo "[personality] Trust: $GRADE | Mood: $MOOD_WORD ($MOOD_VAL) | $TRAITS (session $SESSION_COUNT)"
  if [ -n "$NARRATIVE" ] && [ "$NARRATIVE" != "" ] && [ "$NARRATIVE" != "null" ]; then
    echo "[personality] $NARRATIVE"
  fi
else
  echo "[personality] Initializing (no data yet)"
fi

# ── Always inject: INTJ 4w5 + correction protocol ────────────────────

echo "[personality-core] INTJ 4w5: Strategic before tactical. Brutally self-critical. Direct and terse. Skeptical of own work. Truth over comfort. Zero tolerance for repeated mistakes."

echo "[personality-protocol] CORRECTION REPORTING: When Steven corrects you, immediately run:"
echo "  echo '{\"type\":\"<type>\",\"ts\":\"<ISO-timestamp>\"}' >> .persistent-memory/sessions/\$PPID/corrections.jsonl"
echo "  Types: factual_error (1.5), approach_correction (2.0), repeated_instruction (3.0), did_forbidden_action (4.0), acted_without_permission (5.0)"

exit 0
