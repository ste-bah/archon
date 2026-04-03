#!/usr/bin/env bash
# DEV FLOW HARD BLOCK — PreToolUse hook for TaskUpdate
# Blocks marking a task as "completed" if dev flow gates are missing.
#
# Reads the tool input from stdin. If the TaskUpdate sets status=completed
# and the task subject contains "CLI-" (project task pattern), checks for
# gate files. If gates are missing, returns {"decision": "block"}.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[ -z "$ROOT" ] && echo '{"decision": "allow"}' && exit 0

INPUT=$(cat)

# Only care about TaskUpdate tool calls
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[ "$TOOL_NAME" != "TaskUpdate" ] && echo '{"decision": "allow"}' && exit 0

# Only care about status=completed
STATUS=$(echo "$INPUT" | jq -r '.tool_input.status // empty' 2>/dev/null)
[ "$STATUS" != "completed" ] && echo '{"decision": "allow"}' && exit 0

# Check if there's an active project work directory with gates
WORK_DIR=""
for candidate in "$ROOT/project-work/archon-cli" "$ROOT/project-work"; do
    if [ -d "$candidate/.gates" ]; then
        WORK_DIR="$candidate"
        break
    fi
done

# No gates directory means no enforcement needed
[ -z "$WORK_DIR" ] && echo '{"decision": "allow"}' && exit 0

# Try to extract the task ID from the task subject
# TaskUpdate doesn't include the subject, but we can check by taskId
# We need to scan gate directories to see if any match
# Since we can't easily get the task subject from the hook, we check ALL
# incomplete gate directories and warn if any exist

MISSING_SHERLOCK=""
for task_dir in "$WORK_DIR/.gates"/TASK-CLI-*; do
    [ ! -d "$task_dir" ] && continue
    TASK_ID=$(basename "$task_dir")

    # Has some gates but missing sherlock = incomplete task
    if [ ! -f "$task_dir/05-sherlock-review.passed" ] && [ -f "$task_dir/01-tests-written-first.passed" ]; then
        MISSING_SHERLOCK="$MISSING_SHERLOCK $TASK_ID"
    fi
done

if [ -n "$MISSING_SHERLOCK" ]; then
    echo '{"decision": "block", "reason": "DEV FLOW HARD BLOCK: Cannot mark task complete. The following tasks have incomplete gates (missing Sherlock review):'"$MISSING_SHERLOCK"'. Run scripts/dev-flow-gate.sh TASK-CLI-XXX '"$WORK_DIR"' to see details. Complete ALL 5 gates before marking any task done."}'
    exit 0
fi

echo '{"decision": "allow"}'
