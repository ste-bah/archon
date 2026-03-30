#!/bin/bash
# Claude Code Post-Task Hook Wrapper
#
# Implements: TECH-HKS-001 Post-Task Shell Wrapper
# Constitution: REQ-HKS-016
#
# Executes TypeScript hook with timeout enforcement.
#
# Exit codes:
#   0: Success
#   1: Error
#   3: Timeout (via timeout command returning 124)
#   124: Timeout (raw from timeout command)

set -euo pipefail

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Timeout from environment or default (5000ms = 5s)
TIMEOUT_MS="${HOOKS_TIMEOUT_MS:-5000}"
TIMEOUT_S=$(echo "scale=1; $TIMEOUT_MS/1000" | bc)

# Log function
log() {
    if [[ "${HOOKS_VERBOSE:-false}" == "true" ]]; then
        echo "[post-task.sh] $1" >&2
    fi
}

log "Starting post-task hook (timeout: ${TIMEOUT_S}s)"

# Check if TypeScript hook exists
TS_HOOK="$PROJECT_ROOT/scripts/hooks/post-task.ts"
if [[ ! -f "$TS_HOOK" ]]; then
    echo "[post-task.sh] ERROR: TypeScript hook not found: $TS_HOOK" >&2
    exit 2
fi

# Execute TypeScript hook with timeout
# Note: timeout command returns 124 on timeout
if command -v timeout &> /dev/null; then
    # GNU coreutils timeout available
    timeout "${TIMEOUT_S}s" npx tsx "$TS_HOOK" "$@"
    EXIT_CODE=$?
elif command -v gtimeout &> /dev/null; then
    # macOS with coreutils installed
    gtimeout "${TIMEOUT_S}s" npx tsx "$TS_HOOK" "$@"
    EXIT_CODE=$?
else
    # No timeout command - run without timeout (warn user)
    echo "[post-task.sh] WARN: timeout command not found, running without timeout" >&2
    npx tsx "$TS_HOOK" "$@"
    EXIT_CODE=$?
fi

# Map timeout exit code (124) to our timeout code (3)
if [[ $EXIT_CODE -eq 124 ]]; then
    echo "[post-task.sh] ERROR: Hook timed out after ${TIMEOUT_S}s" >&2
    exit 3
fi

log "Post-task hook completed (exit: $EXIT_CODE)"

exit $EXIT_CODE
