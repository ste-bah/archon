#!/bin/bash
# =============================================================================
# Memory System: Session End Hook (TASK-MEM-005)
# Writes consolidation-pending flag and session summary for next session pickup.
# CANNOT call MCP tools (shell script). Writes plain files only.
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[ -z "$ROOT" ] && exit 0

MEMORY_DIR="$ROOT/.persistent-memory"
mkdir -p "$MEMORY_DIR"

# Write consolidation-pending flag with ISO 8601 timestamp
date -u +%Y-%m-%dT%H:%M:%SZ > "$MEMORY_DIR/consolidation-pending"

# Read hook input from stdin
INPUT=$(cat)

# Extract last assistant message and session ID from JSON payload
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // "No summary available"' 2>/dev/null | head -c 500)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null | tr -d '\n\r')

# Write session summary (overwritten each session, not appended)
{
  echo "Session ended: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Session ID: $SESSION_ID"
  echo "Summary: $LAST_MSG"
} > "$MEMORY_DIR/last-session-summary.txt"

exit 0
