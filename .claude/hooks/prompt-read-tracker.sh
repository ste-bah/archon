#!/bin/bash
# =============================================================================
# PostToolUse[Read] — Track when a pipeline prompt file is read
# =============================================================================
# Writes the read file path to .claude/runtime/.last-pipeline-read
# when the path contains "_next-prompt-". This allows the PreToolUse[Task]
# enforcement hook to verify that the agent prompt was read from the pipeline
# CLI output, not fabricated by the orchestrator.
#
# Input: JSON on stdin from Claude Code PostToolUse event
# Output: none (side effect: writes tracking file)
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$ROOT" ] && exit 0

# Only track during active god-code pipeline
[ ! -f "$ROOT/.claude/runtime/.god-code-active" ] && exit 0

# Read the tool input from stdin
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Check if this is a pipeline prompt file read
if [[ "$FILE_PATH" == *"_next-prompt-"* ]]; then
  mkdir -p "$ROOT/.claude/runtime"
  echo "{\"path\": \"$FILE_PATH\", \"timestamp\": $(date +%s)}" > "$ROOT/.claude/runtime/.last-pipeline-read"

  # Extract PROJECT ROOT from the prompt file content if not already set
  if [ ! -f "$ROOT/.claude/runtime/.pipeline-project-root" ]; then
    # The prompt file was just read — check the actual file for PROJECT ROOT
    RESOLVED_PATH="$FILE_PATH"
    # If relative, resolve from git root
    if [[ "$RESOLVED_PATH" != /* ]]; then
      RESOLVED_PATH="$ROOT/$RESOLVED_PATH"
    fi
    if [ -f "$RESOLVED_PATH" ]; then
      # Look for "PROJECT ROOT:" or "Project Root:" in the file
      PROJ_ROOT=$(grep -iE "^(PROJECT ROOT|Project Root):\s*" "$RESOLVED_PATH" 2>/dev/null | head -1 | sed 's/.*:\s*//' | tr -d '[:space:]')
      if [ -n "$PROJ_ROOT" ] && [ -d "$PROJ_ROOT" ]; then
        echo "$PROJ_ROOT" > "$ROOT/.claude/runtime/.pipeline-project-root"
      fi
    fi
  fi
fi

exit 0
