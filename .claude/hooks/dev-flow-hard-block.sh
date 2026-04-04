#!/usr/bin/env bash
# DEV FLOW HARD BLOCK — PreToolUse hook for TaskUpdate
#
# UNIVERSAL ENFORCEMENT: Works for any project with a .gates/ directory.
#
# When Claude tries to mark ANY task as "completed" via TaskUpdate:
# 1. Extracts TASK-XXX-NNN pattern from task description/subject
# 2. Requires .gates/{TASK-ID}/completed.timestamp to exist
# 3. If missing, BLOCKS with instructions to run the gate scripts
#
# This is the last line of defense. Claude cannot bypass this by
# "forgetting" to run gate scripts — no timestamp, no completion.

set -euo pipefail

INPUT=$(cat)

# Only care about TaskUpdate
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[ "$TOOL_NAME" != "TaskUpdate" ] && echo '{"decision": "allow"}' && exit 0

# Only care about status=completed
STATUS=$(echo "$INPUT" | jq -r '.tool_input.status // empty' 2>/dev/null)
[ "$STATUS" != "completed" ] && echo '{"decision": "allow"}' && exit 0

# Find project root
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[ -z "$ROOT" ] && echo '{"decision": "allow"}' && exit 0

# Extract task description and subject
DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // empty' 2>/dev/null)
SUBJECT=$(echo "$INPUT" | jq -r '.tool_input.subject // empty' 2>/dev/null)
COMBINED="${DESCRIPTION} ${SUBJECT}"

# Extract TASK-XXX-NNN pattern (e.g., TASK-CLI-232, TASK-API-001, etc.)
# Also handle bare CLI-NNN patterns and prepend TASK-
TASK_ID=""

# Try full TASK-XXX-NNN first
FULL_MATCH=$(echo "$COMBINED" | grep -oP 'TASK-[A-Z]+-\d+' | head -1 || true)
if [ -n "$FULL_MATCH" ]; then
    TASK_ID="$FULL_MATCH"
fi

# Fall back to CLI-NNN and prepend TASK-
if [ -z "$TASK_ID" ]; then
    SHORT_MATCH=$(echo "$COMBINED" | grep -oP '[A-Z]+-\d{3,}' | head -1 || true)
    if [ -n "$SHORT_MATCH" ]; then
        TASK_ID="TASK-${SHORT_MATCH}"
    fi
fi

# No task ID found — not a project task, allow
[ -z "$TASK_ID" ] && echo '{"decision": "allow"}' && exit 0

# Find .gates directory that contains THIS task — check multiple locations
GATE_DIR=""
for candidate in \
    "$ROOT/.gates" \
    "$ROOT/project-work/archon-cli/.gates" \
    "$ROOT/project-work/.gates"; do
    if [ -d "$candidate/${TASK_ID}" ]; then
        GATE_DIR="$candidate/${TASK_ID}"
        break
    fi
    # Track if any .gates dir exists at all (for the "no dir" error)
    if [ -d "$candidate" ] && [ -z "$GATE_DIR" ]; then
        GATE_BASE_EXISTS="$candidate"
    fi
done

# If we found the task's gate dir, use it. Otherwise check if gates infra exists.
if [ -z "$GATE_DIR" ]; then
    if [ -n "${GATE_BASE_EXISTS:-}" ]; then
        # Gates infra exists but this task has no gate dir — BLOCK
        GATE_DIR="${GATE_BASE_EXISTS}/${TASK_ID}"
        # Fall through to the hard check below which will see missing dir
    else
        # No gates infrastructure at all — allow (project hasn't opted in)
        echo '{"decision": "allow"}'
        exit 0
    fi
fi

# ================================================================
# THE HARD CHECK
# ================================================================

if [ ! -d "$GATE_DIR" ]; then
    echo '{"decision": "block", "reason": "DEV FLOW HARD BLOCK: Cannot mark '"${TASK_ID}"' complete.\n\nNo gate directory exists. You MUST run all 6 dev flow gates:\n\n  1. scripts/dev-flow-pass-gate.sh '"${TASK_ID}"' 01-tests-written-first \"<evidence>\"\n  2. scripts/dev-flow-pass-gate.sh '"${TASK_ID}"' 02-implementation-complete \"<evidence>\"\n  3. scripts/dev-flow-pass-gate.sh '"${TASK_ID}"' 03-sherlock-code-review \"<evidence>\"\n  4. scripts/dev-flow-pass-gate.sh '"${TASK_ID}"' 04-tests-passing \"<evidence>\"\n  5. scripts/dev-flow-pass-gate.sh '"${TASK_ID}"' 05-live-smoke-test \"<evidence>\"\n  6. scripts/dev-flow-pass-gate.sh '"${TASK_ID}"' 06-sherlock-final-review \"<evidence>\"\n\nThen: scripts/dev-flow-gate.sh '"${TASK_ID}"'"}'
    exit 0
fi

if [ ! -f "$GATE_DIR/completed.timestamp" ]; then
    MISSING=""
    for gate in \
        "01-tests-written-first" \
        "02-implementation-complete" \
        "03-sherlock-code-review" \
        "04-tests-passing" \
        "05-live-smoke-test" \
        "06-sherlock-final-review"; do
        if [ ! -f "$GATE_DIR/${gate}.passed" ]; then
            MISSING="${MISSING}\n  MISSING: ${gate}"
        fi
    done

    if [ -n "$MISSING" ]; then
        echo '{"decision": "block", "reason": "DEV FLOW HARD BLOCK: '"${TASK_ID}"' has incomplete gates:'"${MISSING}"'\n\nRun: scripts/dev-flow-gate.sh '"${TASK_ID}"'"}'
    else
        echo '{"decision": "block", "reason": "DEV FLOW HARD BLOCK: '"${TASK_ID}"' has all gates but no completion timestamp.\nRun: scripts/dev-flow-gate.sh '"${TASK_ID}"'"}'
    fi
    exit 0
fi

# All gates passed AND completion timestamp exists
echo '{"decision": "allow"}'
