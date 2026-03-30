#!/bin/bash
# =============================================================================
# PostToolUse[Write/Edit] — Track source code modifications during pipeline
# =============================================================================
# Sets .code-modified flag when a source file (*.ts, *.js, *.tsx, *.jsx)
# inside the pipeline project root is written. This allows the vitest
# rate-limiter to permit re-runs after code changes (test-fixer flow).
#
# Input: JSON on stdin from Claude Code PostToolUse event
# Output: none (side effect: creates flag file)
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$ROOT" ] && exit 0

RUNTIME="$ROOT/.claude/runtime"

# Only track during active pipeline
[ ! -f "$RUNTIME/.god-code-active" ] && exit 0

# Get the pipeline project root
PROJ_ROOT=$(cat "$RUNTIME/.pipeline-project-root" 2>/dev/null | tr -d '[:space:]')
[ -z "$PROJ_ROOT" ] && exit 0

# Read the written file path from stdin
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

# Check: is file inside the project root?
case "$FILE_PATH" in
  "$PROJ_ROOT"*) ;; # Inside project root — continue
  *) exit 0 ;;       # Outside project root — ignore
esac

# Check: is it a source file?
case "$FILE_PATH" in
  *.ts|*.js|*.tsx|*.jsx|*.json)
    # Exclude test output files and pipeline artifacts
    case "$FILE_PATH" in
      *.test.ts|*.test.js|*.spec.ts|*.spec.js) ;; # Test files count as code changes
      */.god-agent/*|*/pipeline-output/*) exit 0 ;; # Pipeline artifacts don't count
      *)  ;; # Source files count
    esac
    touch "$RUNTIME/.code-modified"
    ;;
esac

exit 0
