#!/bin/bash
# =============================================================================
# Personality Event Logger — PostToolUse hook
# Appends lightweight tool call events to a JSONL file for session-end
# batch processing. Runs on EVERY tool call. Must be < 1ms.
# Session isolation via $PPID.
# =============================================================================

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0

SID="$PPID"
SESSION_DIR="$ROOT/.persistent-memory/sessions/$SID"
mkdir -p "$SESSION_DIR" 2>/dev/null
EVENTS_FILE="$SESSION_DIR/events.jsonl"

# Read tool info from stdin (Claude Code pipes hook data as JSON)
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // .tool_input.command // "none"' 2>/dev/null)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "{\"ts\":\"$TIMESTAMP\",\"tool\":\"$TOOL_NAME\",\"target\":\"${FILE_PATH:0:200}\"}" >> "$EVENTS_FILE" 2>/dev/null

exit 0
