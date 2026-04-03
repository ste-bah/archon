#!/usr/bin/env bash
# DEV FLOW GATE — Validates that all dev flow steps were completed for a task.
# Usage: ./scripts/dev-flow-gate.sh TASK-CLI-XXX /path/to/project-work/dir
#
# Exit codes:
#   0 = all gates passed
#   1 = one or more gates FAILED — task CANNOT be marked complete
#
# This script is the LAW. No task is done until it says so.

set -euo pipefail

TASK_ID="${1:?Usage: dev-flow-gate.sh TASK-CLI-XXX /path/to/work/dir}"
WORK_DIR="${2:?Usage: dev-flow-gate.sh TASK-CLI-XXX /path/to/work/dir}"
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
        echo -e "  ${GREEN}PASS${NC}  ${gate_name}"
    else
        echo -e "  ${RED}FAIL${NC}  ${gate_name} — file missing: ${gate_file}"
        FAILURES=$((FAILURES + 1))
    fi
}

echo "============================================"
echo "DEV FLOW GATE CHECK: ${TASK_ID}"
echo "============================================"
echo ""

# Check all 5 mandatory gates
check_gate "01-tests-written-first"
check_gate "02-implementation-complete"
check_gate "03-tests-passing"
check_gate "04-live-smoke-test"
check_gate "05-sherlock-review"

echo ""

if [[ $FAILURES -gt 0 ]]; then
    echo -e "${RED}BLOCKED: ${FAILURES} gate(s) failed. Task ${TASK_ID} CANNOT be marked complete.${NC}"
    echo ""
    echo "To pass a gate, create the marker file:"
    echo "  mkdir -p ${GATE_DIR}/${TASK_ID}"
    echo "  echo 'PASSED: <evidence>' > ${GATE_DIR}/${TASK_ID}/<gate-name>.passed"
    echo ""
    echo "Gates must be passed IN ORDER. No skipping."
    exit 1
else
    echo -e "${GREEN}ALL GATES PASSED. Task ${TASK_ID} may be marked complete.${NC}"
    # Write completion timestamp
    date -Iseconds > "${GATE_DIR}/${TASK_ID}/completed.timestamp"
    exit 0
fi
