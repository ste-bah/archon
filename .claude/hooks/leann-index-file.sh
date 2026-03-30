#!/bin/bash
# leann-index-file.sh
# Queues a file for LEANN indexing (batch processed at session end)
# Called from PostToolUse hook for Write|Edit|MultiEdit

set -euo pipefail

FILE_PATH="${1:-}"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
QUEUE_FILE="$ROOT/.claude/runtime/leann-index-queue.json"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only index code files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.py|*.rs|*.go|*.java|*.c|*.cpp|*.cs|*.rb|*.php|*.sql)
    ;;
  *)
    exit 0
    ;;
esac

# Skip non-project paths (venvs, third-party, build artifacts)
REJECT_PATTERNS=(
  "node_modules"
  "site-packages"
  "__pycache__"
  "__pypackages__"
  "/.venv/"
  "/venv/"
  "/.tv/"
  "/dist/"
  "/build/"
  "/target/"
  "/.git/"
  "/.claude/worktrees/"
  "/coverage/"
  ".egg-info"
  ".min.js"
  ".bundle.js"
)
for pattern in "${REJECT_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    exit 0
  fi
done

# Check file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Ensure runtime dir exists
mkdir -p "$ROOT/.claude/runtime"

# Initialize queue file if not exists
if [ ! -f "$QUEUE_FILE" ]; then
  echo '{"files":[],"lastUpdated":""}' > "$QUEUE_FILE"
fi

# Add file to queue (using jq if available, otherwise simple append)
if command -v jq &> /dev/null; then
  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  TEMP_FILE=$(mktemp)
  jq --arg file "$FILE_PATH" --arg ts "$TIMESTAMP" \
    '.files = (.files + [$file] | unique) | .lastUpdated = $ts' \
    "$QUEUE_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$QUEUE_FILE"
else
  echo "$FILE_PATH" >> "$ROOT/.claude/runtime/leann-index-queue.txt"
fi

exit 0
