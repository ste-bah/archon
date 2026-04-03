#!/usr/bin/env bash
# DEV FLOW ENFORCEMENT HOOK
# Runs on TaskCompleted. Checks if the completed task has a TASK-CLI-* pattern
# and if so, verifies all 5 dev flow gates are passed.
#
# If gates are missing, prints a loud warning to stderr (visible in hook output).
# This is advisory — cannot block TaskUpdate directly, but the warning is
# injected into the conversation context so Claude MUST see it.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$ROOT" ] && exit 0

# Read the task update info from stdin (if available)
INPUT=$(cat 2>/dev/null || echo "{}")

# Check if there's an active project work directory with gates
WORK_DIR=""
for candidate in "$ROOT/project-work/archon-cli" "$ROOT/project-work"; do
    if [ -d "$candidate" ]; then
        WORK_DIR="$candidate"
        break
    fi
done

[ -z "$WORK_DIR" ] && exit 0
[ ! -d "$WORK_DIR/.gates" ] && exit 0

# Check all tasks that have gate directories but are missing the sherlock gate
VIOLATIONS=""
for task_dir in "$WORK_DIR/.gates"/TASK-CLI-*; do
    [ ! -d "$task_dir" ] && continue
    TASK_ID=$(basename "$task_dir")

    if [ ! -f "$task_dir/05-sherlock-review.passed" ]; then
        VIOLATIONS="$VIOLATIONS  - $TASK_ID: MISSING sherlock review gate\n"
    fi
    if [ ! -f "$task_dir/04-live-smoke-test.passed" ]; then
        VIOLATIONS="$VIOLATIONS  - $TASK_ID: MISSING live smoke test gate\n"
    fi
done

if [ -n "$VIOLATIONS" ]; then
    echo ""
    echo "================================================================"
    echo "DEV FLOW ENFORCEMENT WARNING"
    echo "================================================================"
    echo "The following tasks have INCOMPLETE dev flow gates:"
    echo ""
    echo -e "$VIOLATIONS"
    echo "Run: $ROOT/scripts/dev-flow-gate.sh TASK-CLI-XXX $WORK_DIR"
    echo "to check all gates for a specific task."
    echo ""
    echo "REMINDER: Sherlock review is a BLOCKER. No task is done without it."
    echo "================================================================"
fi
