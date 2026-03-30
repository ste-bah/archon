#!/bin/bash
# leann-session-catchup.sh
# Processes any stale files left in the LEANN index queue from previous sessions.
# Intended to be wired into a SessionStart hook.
# Runs with a shorter timeout (60s) to avoid blocking session startup.

set -uo pipefail  # no -e: indexing failures must NOT block session start

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
QUEUE_FILE="$ROOT/.claude/runtime/leann-index-queue.json"

# Quick exit if no queue file
if [[ ! -f "$QUEUE_FILE" ]]; then
  exit 0
fi

# Check queue has files
QUEUE_COUNT=$(jq '.files | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
if [[ "$QUEUE_COUNT" -eq 0 ]]; then
  exit 0
fi

echo "[LEANN] Session catchup: $QUEUE_COUNT files pending from previous session"

# Run the TS processor with a shorter timeout
PROCESSOR="$ROOT/scripts/hooks/leann-process-queue.ts"
if [[ -f "$PROCESSOR" ]]; then
  set +e
  timeout 60 npx tsx "$PROCESSOR" --timeout 55 2>&1 | while IFS= read -r line; do
    echo "  $line"
  done
  EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [[ $EXIT_CODE -eq 124 ]]; then
    echo "[LEANN] Session catchup timed out — remaining files will be processed later"
  elif [[ $EXIT_CODE -ne 0 ]]; then
    echo "[LEANN] Session catchup exited with code $EXIT_CODE (non-blocking)"
  fi
else
  echo "[LEANN] Processor not found at $PROCESSOR — skipping catchup"
fi

# Always exit 0 — never block session start
exit 0
