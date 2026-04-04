#!/usr/bin/env bash
# DEV FLOW GATE — Validates that all dev flow steps were completed for a task.
# Usage: ./scripts/dev-flow-gate.sh TASK-XXX [/path/to/work/dir]
#
# If work dir is omitted, uses git repo root.
#
# Exit codes:
#   0 = all gates passed
#   1 = one or more gates FAILED — task CANNOT be marked complete
#
# This script is the LAW. No task is done until it says so.

set -euo pipefail

TASK_ID="${1:?Usage: dev-flow-gate.sh TASK-XXX [/path/to/work/dir]}"

# Work dir: explicit arg, or git root, or cwd
if [ -n "${2:-}" ]; then
    WORK_DIR="$2"
elif ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    WORK_DIR="$ROOT"
else
    WORK_DIR="$(pwd)"
fi

GATE_DIR="${WORK_DIR}/.gates"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

FAILURES=0

check_gate() {
    local gate_name="$1"
    local gate_file="${GATE_DIR}/${TASK_ID}/${gate_name}.passed"

    if [[ -f "$gate_file" ]]; then
        local evidence
        evidence=$(grep "^Evidence:" "$gate_file" 2>/dev/null | head -1 | sed 's/^Evidence: //')
        echo -e "  ${GREEN}PASS${NC}  ${gate_name}"
        if [[ -n "$evidence" ]]; then
            echo -e "        ${evidence:0:80}"
        fi
    else
        echo -e "  ${RED}FAIL${NC}  ${gate_name} — not passed"
        FAILURES=$((FAILURES + 1))
    fi
}

echo "============================================"
echo "DEV FLOW GATE CHECK: ${TASK_ID}"
echo "Work dir: ${WORK_DIR}"
echo "============================================"
echo ""

# Check all 6 mandatory gates
check_gate "01-tests-written-first"
check_gate "02-implementation-complete"
check_gate "03-sherlock-code-review"
check_gate "04-tests-passing"
check_gate "05-live-smoke-test"
check_gate "06-sherlock-final-review"

echo ""

if [[ $FAILURES -gt 0 ]]; then
    echo -e "${RED}BLOCKED: ${FAILURES} gate(s) failed. Task ${TASK_ID} CANNOT be marked complete.${NC}"
    echo ""
    echo "To pass a gate:"
    echo "  scripts/dev-flow-pass-gate.sh ${TASK_ID} <gate-name> \"evidence\" ${WORK_DIR}"
    echo ""
    echo "Gates must be passed IN ORDER. No skipping."
    exit 1
else
    echo -e "${GREEN}ALL 6 GATES PASSED. Task ${TASK_ID} may be marked complete.${NC}"
    # Write completion timestamp
    date -Iseconds > "${GATE_DIR}/${TASK_ID}/completed.timestamp"
    exit 0
fi
