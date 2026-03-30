#!/bin/bash
# =============================================================================
# PreToolUse[Bash] — Rate-limit vitest during pipeline mode
# =============================================================================
# During active /god-code pipeline, only allows ONE vitest run per 30 minutes
# unless code was modified (test-fixer flow) or the previous run failed.
#
# Uses mkdir for atomic locking (race-safe for parallel agents).
#
# Input: JSON on stdin from Claude Code PreToolUse event
# Output: JSON {"decision": "allow"} or {"decision": "block", "reason": "..."}
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$ROOT" ] && echo '{"decision": "allow"}' && exit 0

RUNTIME="$ROOT/.claude/runtime"
ACTIVE_FILE="$RUNTIME/.god-code-active"
LOCK_DIR="$RUNTIME/.vitest-ran"
CODE_MOD="$RUNTIME/.code-modified"

# Only enforce during active pipeline
[ ! -f "$ACTIVE_FILE" ] && echo '{"decision": "allow"}' && exit 0

# ── SDK pipeline stale flag detection ─────────────────────────────────
# If .god-code-sdk-active exists, check PID liveness + age.
# If the SDK runner process is dead or the flag is >4 hours old,
# the flag is stale (SIGKILL / OOM / power loss) — clean up and allow.
SDK_ACTIVE="$RUNTIME/.god-code-sdk-active"
if [ -f "$SDK_ACTIVE" ]; then
  SDK_PID=$(jq -r '.pid // empty' "$SDK_ACTIVE" 2>/dev/null)
  SDK_STARTED=$(jq -r '.startedAt // 0' "$SDK_ACTIVE" 2>/dev/null)
  NOW_SEC=$(date +%s)
  SDK_AGE=$(( NOW_SEC - SDK_STARTED ))

  # PID dead → stale flag from crash
  if [ -n "$SDK_PID" ] && ! kill -0 "$SDK_PID" 2>/dev/null; then
    rm -f "$SDK_ACTIVE" "$ACTIVE_FILE"
    echo '{"decision": "allow"}'
    exit 0
  fi

  # Flag >4 hours old → stale regardless of PID (handles PID recycling)
  if [ "$SDK_AGE" -gt 14400 ]; then
    rm -f "$SDK_ACTIVE" "$ACTIVE_FILE"
    echo '{"decision": "allow"}'
    exit 0
  fi
fi

# Read command from stdin
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && echo '{"decision": "allow"}' && exit 0

# Check if this is a vitest/test command
IS_TEST=false
case "$COMMAND" in
  *vitest*|*"npm test"*|*"npm run test"*|*"npx jest"*)
    IS_TEST=true
    ;;
esac

[ "$IS_TEST" = false ] && echo '{"decision": "allow"}' && exit 0

# --- This is a test command during active pipeline ---

# Check if lock dir exists (previous run)
if [ -d "$LOCK_DIR" ]; then
  # Check age
  LOCK_TS=$(cat "$LOCK_DIR/timestamp" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  AGE=$(( NOW - LOCK_TS ))

  # If older than 30 minutes, lock expired — allow fresh run
  if [ "$AGE" -gt 1800 ]; then
    rm -rf "$LOCK_DIR"
    # Fall through to allow
  else
    # Lock is fresh — check if code was modified
    if [ -f "$CODE_MOD" ]; then
      # Code changed since last run — allow re-run
      rm -f "$CODE_MOD"
      rm -rf "$LOCK_DIR"
      # Fall through to allow
    else
      # Check if previous run failed
      PREV_EXIT=$(cat "$LOCK_DIR/exit_code" 2>/dev/null || echo "0")
      if [ "$PREV_EXIT" != "0" ]; then
        # Previous run failed — allow retry
        rm -rf "$LOCK_DIR"
        # Fall through to allow
      else
        # Recent successful run, no code changes — BLOCK
        cat <<BLOCK
{
  "decision": "block",
  "reason": "VITEST RATE LIMIT: vitest already ran ${AGE}s ago and passed. No code was modified since. Read cached results instead of re-running. If you need to re-run after fixing code, the Write/Edit hook sets a .code-modified flag automatically."
}
BLOCK
        exit 0
      fi
    fi
  fi
fi

# Allow the run — create atomic lock
if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date +%s)" > "$LOCK_DIR/timestamp"
  echo "0" > "$LOCK_DIR/exit_code"
fi

echo '{"decision": "allow"}'
exit 0
