#!/bin/bash
# Causal Check Hook
#
# Triggers on PreToolUse (Bash tool) to query for historical failure patterns
# and warn about risky commands before execution.
#
# PRD: PRD-GOD-AGENT-001
# Task: TASK-HOOK-004
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

main() {
    local input=""
    if ! [ -t 0 ]; then
        input=$(cat)
    fi

    cd "$PROJECT_ROOT"
    if [ -n "$input" ]; then
        echo "$input" | timeout 0.5s npx tsx scripts/hooks/causal-check.ts 2>/dev/null
    else
        timeout 0.5s npx tsx scripts/hooks/causal-check.ts 2>/dev/null
    fi
    exit $?
}

main "$@"
