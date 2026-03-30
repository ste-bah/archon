#!/bin/bash
# Session Feedback Hook
#
# Triggers on Notification (feedback) event to call SoNA.provideFeedback()
# with sentiment analysis for weight adjustment.
#
# PRD: PRD-GOD-AGENT-001
# Task: TASK-HOOK-008
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
        echo "$input" | timeout 0.5s npx tsx scripts/hooks/session-feedback.ts 2>/dev/null
    else
        timeout 0.5s npx tsx scripts/hooks/session-feedback.ts 2>/dev/null
    fi
    exit $?
}

main "$@"
