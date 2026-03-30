#!/bin/bash
# =============================================================================
# PreToolUse[Task/Agent] — Enforce prompt-file-first rule
# =============================================================================
# During active /god-code pipeline, BLOCKS any Agent spawn that was not
# preceded by a Read of a _next-prompt-*.txt file.
#
# This prevents the orchestrator from:
# - Writing custom prompts instead of using pipeline CLI output
# - Skipping the Read step and composing prompts from memory
# - Shortcutting verification agents with hand-crafted summaries
#
# Input: JSON on stdin from Claude Code PreToolUse event
# Output: JSON {"decision": "allow"} or {"decision": "block", "reason": "..."}
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$ROOT" ] && echo '{"decision": "allow"}' && exit 0

RUNTIME_DIR="$ROOT/.claude/runtime"
TRACKING_FILE="$RUNTIME_DIR/.last-pipeline-read"
ACTIVE_FILE="$RUNTIME_DIR/.god-code-active"

# Only enforce during active god-code pipeline
if [ ! -f "$ACTIVE_FILE" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check if a pipeline prompt file was read recently
if [ ! -f "$TRACKING_FILE" ]; then
  cat <<'BLOCK'
{
  "decision": "block",
  "reason": "PIPELINE ENFORCEMENT: You MUST Read the PROMPT_FILE from the pipeline CLI before spawning an Agent. No _next-prompt-*.txt file was read since the last agent. Run: Read('<PROMPT_FILE path from complete-and-next output>') first."
}
BLOCK
  exit 0
fi

# Check timestamp — must be within last 120 seconds
TRACKED_TS=$(jq -r '.timestamp // 0' "$TRACKING_FILE" 2>/dev/null)
NOW=$(date +%s)
AGE=$(( NOW - TRACKED_TS ))

if [ "$AGE" -gt 120 ]; then
  cat <<BLOCK
{
  "decision": "block",
  "reason": "PIPELINE ENFORCEMENT: The last pipeline prompt Read was ${AGE}s ago (stale). You MUST Read the current PROMPT_FILE before spawning this Agent. The prompt file from complete-and-next must be read fresh."
}
BLOCK
  exit 0
fi

# Prompt was read recently — allow and clear the tracking file
rm -f "$TRACKING_FILE"
echo '{"decision": "allow"}'
exit 0
