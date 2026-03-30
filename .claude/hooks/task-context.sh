#!/bin/bash
# Task Context Hook
#
# Triggers on PreToolUse (Task tool) to query ReasoningBank/UnifiedSearch
# for relevant patterns and inject context into the prompt.
#
# PRD: PRD-GOD-AGENT-001
# Task: TASK-HOOK-003
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
        echo "$input" | timeout 0.5s npx tsx scripts/hooks/task-context.ts 2>/dev/null
    else
        timeout 0.5s npx tsx scripts/hooks/task-context.ts 2>/dev/null
    fi
    exit $?
}

main "$@"
