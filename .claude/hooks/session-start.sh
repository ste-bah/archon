#!/bin/bash
# Session Start Hook
# Triggers on Claude Code SessionStart event
#
# PRD: PRD-GOD-AGENT-001
# Task: TASK-HOOK-001
#
# Restores SoNA domain weights and previous session context.
# Must complete within 500ms timeout per constitution.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

main() {
    local input=""

    # Read input from stdin if available (not a terminal)
    if ! [ -t 0 ]; then
        input=$(cat)
    fi

    # Change to project root for correct relative paths
    cd "$PROJECT_ROOT"

    # Execute TypeScript handler with 500ms timeout
    if [ -n "$input" ]; then
        echo "$input" | timeout 0.5s npx tsx scripts/hooks/session-start.ts 2>/dev/null
    else
        timeout 0.5s npx tsx scripts/hooks/session-start.ts 2>/dev/null
    fi

    exit $?
}

main "$@"
