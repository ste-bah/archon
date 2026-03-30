#!/bin/bash
# =============================================================================
# LEANN Index Queue Drain
# Processes queued files in small batches to keep the code search index fresh.
# Runs via launchd every 15 minutes.
#
# Calls the LEANN MCP server's process_queue via a lightweight claude -p.
# Only runs if the queue has files. Skips silently if empty.
#
# Alternative: could call the Node.js indexing directly, but MCP tools
# handle embedding + HNSW insertion atomically. The claude -p cost is
# ~$0.08/batch which is acceptable for 4 batches/hour max.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${ARCHON_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
QUEUE_FILE="${PROJECT_ROOT}/.claude/runtime/leann-index-queue.json"
LOG_FILE="${HOME}/.archon/logs/leann-drain.log"
LOCK_DIR="/tmp/archon-leann-drain.lock"

mkdir -p "${HOME}/.archon/logs" 2>/dev/null

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG_FILE"; }

# Rotate log at 1MB
if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG_FILE" "${LOG_FILE}.bak"
fi

# Check if queue exists and has files
if [ ! -f "$QUEUE_FILE" ]; then
    exit 0
fi

COUNT=$(jq '.files | length' "$QUEUE_FILE" 2>/dev/null || echo 0)
if [ "${COUNT:-0}" -eq 0 ]; then
    exit 0
fi

# Lock to prevent concurrent drains
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

log "Queue: ${COUNT} files — draining batch of 20"

# Run from project root (not /tmp) because LEANN MCP uses relative paths
cd "$PROJECT_ROOT"
RESULT=$(claude -p "Call mcp__leann-search__process_queue with maxFiles 20. Report files processed and remaining." \
    --output-format json \
    --model haiku \
    --max-budget-usd 0.20 \
    --max-turns 3 \
    --no-session-persistence \
    --allowedTools "mcp__leann-search__process_queue" \
    --system-prompt "Call process_queue once. Report result. Be terse." \
    2>/dev/null)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ] && echo "$RESULT" | jq empty 2>/dev/null; then
    COST=$(echo "$RESULT" | jq -r '.total_cost_usd // 0')
    SUMMARY=$(echo "$RESULT" | jq -r '.result // "no result"' | head -c 200)
    log "OK (\$${COST}) ${SUMMARY}"
else
    log "FAIL (exit: ${EXIT_CODE})"
fi
