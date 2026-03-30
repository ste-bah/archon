#!/bin/bash
# Agent Complete Hook
#
# Triggers on SubagentStop event to create GraphDB hyperedges
# for high-quality agent completions (quality >= 0.7).
#
# PRD: PRD-GOD-AGENT-001
# Task: TASK-HOOK-006
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
        echo "$input" | timeout 0.5s npx tsx scripts/hooks/agent-complete.ts 2>/dev/null
    else
        timeout 0.5s npx tsx scripts/hooks/agent-complete.ts 2>/dev/null
    fi
    exit $?
}

main "$@"
