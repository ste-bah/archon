#!/bin/bash
# =============================================================================
# Personality Behavioral Gate — PreToolUse hook for Write/Edit
# Soft gate: outputs behavioral hints when correction threshold exceeded
# or anomalies detected. Does NOT block (exit 0 always). <5ms.
# Session isolation via $PPID.
# =============================================================================

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0

SID="$PPID"
SESSION_DIR="$ROOT/.persistent-memory/sessions/$SID"
CORRECTIONS_FILE="$SESSION_DIR/corrections.jsonl"
EVENTS_FILE="$SESSION_DIR/events.jsonl"
CACHE_FILE="$SESSION_DIR/state.json"

CORRECTION_THRESHOLD=3

# Read current tool target from stdin
INPUT=$(cat)
TARGET=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // "unknown"' 2>/dev/null)

# --- Signal 1: Correction count ---
CORRECTION_COUNT=0
if [ -f "$CORRECTIONS_FILE" ]; then
  CORRECTION_COUNT=$(wc -l < "$CORRECTIONS_FILE" 2>/dev/null | tr -d ' ')
fi

# --- Signal 2: Repeated edits without test ---
REPEATED_EDIT=false
if [ -f "$EVENTS_FILE" ] && [ -n "$TARGET" ] && [ "$TARGET" != "unknown" ]; then
  EDIT_COUNT=$(tail -10 "$EVENTS_FILE" 2>/dev/null | grep -c "$TARGET" 2>/dev/null || true)
  EDIT_COUNT=${EDIT_COUNT:-0}
  HAS_TEST=$(tail -10 "$EVENTS_FILE" 2>/dev/null | grep -c 'pytest\|vitest\|npm test' 2>/dev/null || true)
  HAS_TEST=${HAS_TEST:-0}
  if [ "$EDIT_COUNT" -ge 3 ] && [ "$HAS_TEST" -eq 0 ]; then
    REPEATED_EDIT=true
  fi
fi

# --- Signal 3: Cached personality state ---
CACHED_STATE=""
CACHED_HINTS=""
if [ -f "$CACHE_FILE" ]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [ "$CACHE_AGE" -lt 1800 ]; then
    CACHED_STATE=$(jq -r '.state // "neutral"' "$CACHE_FILE" 2>/dev/null)
    CACHED_HINTS=$(jq -r '
      if .hints then
        "[PERSONALITY STATE: " + .state + " | Val: " + .hints.validation_level + ", Verb: " + .hints.response_verbosity + ", Expl: " + .hints.exploration_mode + "]"
      else empty end
    ' "$CACHE_FILE" 2>/dev/null)
  fi
fi

# --- Output ---
OUTPUT=""

if [ "$CORRECTION_COUNT" -ge "$CORRECTION_THRESHOLD" ]; then
  OUTPUT="[PERSONALITY GATE: ${CORRECTION_COUNT} corrections this session (threshold: ${CORRECTION_THRESHOLD}). STATE: cautious. RULE: Present your proposed changes as a plan and wait for explicit approval before modifying files.]"
fi

if [ "$REPEATED_EDIT" = true ]; then
  if [ -n "$OUTPUT" ]; then OUTPUT="$OUTPUT "; fi
  OUTPUT="${OUTPUT}[METACOGNITIVE: ${TARGET} edited ${EDIT_COUNT}+ times without test run. Run tests before further edits.]"
fi

if [ -n "$CACHED_HINTS" ] && [ "$CACHED_STATE" != "neutral" ] && [ "$CORRECTION_COUNT" -lt "$CORRECTION_THRESHOLD" ]; then
  if [ -n "$OUTPUT" ]; then OUTPUT="$OUTPUT "; fi
  OUTPUT="${OUTPUT}${CACHED_HINTS}"
fi

if [ -n "$OUTPUT" ]; then
  echo "$OUTPUT"
fi

exit 0
