#!/usr/bin/env bash
# Pass a specific dev flow gate for a task.
# Usage: ./scripts/dev-flow-pass-gate.sh TASK-CLI-XXX gate-name "evidence" /path/to/work/dir
#
# Gate names (must be passed in order):
#   01-tests-written-first    — Test files exist before implementation
#   02-implementation-complete — Code written and compiles
#   03-tests-passing           — All tests pass (include test count)
#   04-live-smoke-test         — Feature actually invoked end-to-end
#   05-sherlock-review         — Sherlock agent reviewed, verdict included
#
# Gate 4 enforcement:
#   Evidence is checked for fraud patterns. If the evidence looks like
#   "tests pass" or "library crate" instead of actual binary execution
#   proof, the gate is BLOCKED.
#
#   Valid Gate 4 evidence MUST contain one of:
#     - A command that was run and its output
#     - "WIRING_VERIFIED:" prefix with grep/call-chain proof
#     - A path to a screenshot or log file
#
#   Blocked phrases (case-insensitive):
#     "library crate", "binary builds", "wiring happens",
#     "tests pass", "API surface", "wiring in CLI-",
#     "wiring in TASK-", "not yet wired", "deferred to"

set -euo pipefail

TASK_ID="${1:?Usage: dev-flow-pass-gate.sh TASK-CLI-XXX gate-name 'evidence' /path/to/work/dir}"
GATE_NAME="${2:?Provide gate name (e.g., 05-sherlock-review)}"
EVIDENCE="${3:?Provide evidence string}"
WORK_DIR="${4:?Provide work directory}"

GATE_DIR="${WORK_DIR}/.gates/${TASK_ID}"
GATE_FILE="${GATE_DIR}/${GATE_NAME}.passed"

# Validate gate name
VALID_GATES=("01-tests-written-first" "02-implementation-complete" "03-tests-passing" "04-live-smoke-test" "05-sherlock-review")
VALID=false
for g in "${VALID_GATES[@]}"; do
    if [[ "$g" == "$GATE_NAME" ]]; then
        VALID=true
        break
    fi
done

if [[ "$VALID" != "true" ]]; then
    echo "ERROR: Invalid gate name '${GATE_NAME}'"
    echo "Valid gates: ${VALID_GATES[*]}"
    exit 1
fi

# Enforce ordering — cannot pass gate N if gate N-1 is not passed
GATE_NUM="${GATE_NAME:0:2}"
if [[ "$GATE_NUM" != "01" ]]; then
    PREV_NUM=$(printf "%02d" $((10#$GATE_NUM - 1)))
    PREV_FOUND=false
    for f in "${GATE_DIR}/${PREV_NUM}-"*.passed; do
        if [[ -f "$f" ]]; then
            PREV_FOUND=true
            break
        fi
    done
    if [[ "$PREV_FOUND" != "true" ]]; then
        echo "ERROR: Cannot pass gate ${GATE_NAME} — previous gate (${PREV_NUM}-*) not yet passed."
        echo "Gates must be passed IN ORDER."
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Gate 4 fraud detection — block evidence that doesn't prove binary execution
# ---------------------------------------------------------------------------
if [[ "$GATE_NAME" == "04-live-smoke-test" ]]; then
    EVIDENCE_LOWER=$(echo "$EVIDENCE" | tr '[:upper:]' '[:lower:]')

    # Blocked phrases — these indicate the feature wasn't actually tested
    # in a running binary. Add new patterns here as they're discovered.
    FRAUD_PATTERNS=(
        "library crate"
        "binary builds"
        "wiring happens"
        "tests pass"
        "api surface"
        "wiring in cli-"
        "wiring in task-"
        "not yet wired"
        "deferred to"
        "will be wired"
        "wired later"
        "integration work"
        "same public api"
        "library-only"
    )

    for pattern in "${FRAUD_PATTERNS[@]}"; do
        if [[ "$EVIDENCE_LOWER" == *"$pattern"* ]]; then
            echo ""
            echo "================================================================"
            echo "  GATE 4 BLOCKED — FRAUD PATTERN DETECTED"
            echo "================================================================"
            echo ""
            echo "  Evidence contains: \"${pattern}\""
            echo ""
            echo "  Gate 4 (live-smoke-test) requires PROOF that the feature"
            echo "  works in a running binary. Not that tests pass. Not that"
            echo "  it compiles. Not that wiring happens later."
            echo ""
            echo "  Valid evidence must include ONE of:"
            echo "    1. The command you ran and its actual output"
            echo "    2. WIRING_VERIFIED: <grep proof that binary calls the code>"
            echo "    3. Path to a screenshot or log showing the feature working"
            echo ""
            echo "  If this is a library-only module with no user-facing behavior,"
            echo "  you MUST wire it into the binary BEFORE passing Gate 4."
            echo ""
            echo "  DO NOT mark library modules as smoke-tested."
            echo "  DO NOT defer wiring to another task."
            echo "  A module not called from the binary is NOT DONE."
            echo ""
            echo "================================================================"
            exit 1
        fi
    done

    # Require positive evidence — must contain at least one proof indicator
    PROOF_FOUND=false
    PROOF_INDICATORS=(
        "wiring_verified:"
        "ran:"
        "output:"
        "command:"
        "screenshot:"
        "log:"
        "$ "
        "./target/"
        "cargo run"
        "npm run"
        "python "
        "node "
        "exercised:"
        "verified by running"
        "invoked"
    )

    for indicator in "${PROOF_INDICATORS[@]}"; do
        if [[ "$EVIDENCE_LOWER" == *"$indicator"* ]]; then
            PROOF_FOUND=true
            break
        fi
    done

    if [[ "$PROOF_FOUND" != "true" ]]; then
        echo ""
        echo "================================================================"
        echo "  GATE 4 WARNING — NO EXECUTION PROOF DETECTED"
        echo "================================================================"
        echo ""
        echo "  Evidence doesn't contain recognizable execution proof."
        echo "  Expected one of: a command, output, screenshot path,"
        echo "  WIRING_VERIFIED:, or description of invoking the feature."
        echo ""
        echo "  Proceeding anyway, but this evidence is SUSPECT."
        echo "  If you're passing a library module without binary proof,"
        echo "  you WILL be caught by Sherlock or the next review."
        echo ""
        echo "================================================================"
        # Warning only — don't block, but make it loud
    fi
fi

mkdir -p "$GATE_DIR"
{
    echo "PASSED"
    echo "Task: ${TASK_ID}"
    echo "Gate: ${GATE_NAME}"
    echo "Time: $(date -Iseconds)"
    echo "Evidence: ${EVIDENCE}"
} > "$GATE_FILE"

echo "Gate ${GATE_NAME} PASSED for ${TASK_ID}"
