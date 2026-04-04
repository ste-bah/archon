#!/usr/bin/env bash
# Pass a specific dev flow gate for a task.
# Usage: ./scripts/dev-flow-pass-gate.sh TASK-XXX gate-name "evidence" [/path/to/work/dir]
#
# If work dir is omitted, uses git repo root.
#
# Gate names (must be passed in order):
#   01-tests-written-first      — Test files exist before implementation
#   02-implementation-complete   — Code written and compiles
#   03-sherlock-code-review      — Sherlock adversarial review of implementation
#   04-tests-passing             — All tests pass (include test count)
#   05-live-smoke-test           — Feature actually invoked end-to-end
#   06-sherlock-final-review     — Sherlock final review: integration + wiring
#
# Gate 3 enforcement:
#   Evidence MUST contain "APPROVED" or "PASS" (from Sherlock verdict).
#   If evidence contains "REJECTED" or "FAIL", the gate is BLOCKED.
#
# Gate 5 enforcement:
#   Evidence is checked for fraud patterns. If the evidence looks like
#   "tests pass" or "library crate" instead of actual binary execution
#   proof, the gate is BLOCKED.
#
# Gate 6 enforcement:
#   Same as Gate 3 — must contain Sherlock verdict.

set -euo pipefail

TASK_ID="${1:?Usage: dev-flow-pass-gate.sh TASK-XXX gate-name 'evidence' [/path/to/work/dir]}"
GATE_NAME="${2:?Provide gate name (e.g., 03-sherlock-code-review)}"
EVIDENCE="${3:?Provide evidence string}"

# Work dir: explicit arg, or git root, or cwd
if [ -n "${4:-}" ]; then
    WORK_DIR="$4"
elif ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    WORK_DIR="$ROOT"
else
    WORK_DIR="$(pwd)"
fi

GATE_DIR="${WORK_DIR}/.gates/${TASK_ID}"
GATE_FILE="${GATE_DIR}/${GATE_NAME}.passed"

# Validate gate name
VALID_GATES=(
    "01-tests-written-first"
    "02-implementation-complete"
    "03-sherlock-code-review"
    "04-tests-passing"
    "05-live-smoke-test"
    "06-sherlock-final-review"
)
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
# Gate 3 + Gate 6: Sherlock verdict enforcement
# ---------------------------------------------------------------------------
if [[ "$GATE_NAME" == "03-sherlock-code-review" || "$GATE_NAME" == "06-sherlock-final-review" ]]; then
    EVIDENCE_UPPER=$(echo "$EVIDENCE" | tr '[:lower:]' '[:upper:]')

    # Must contain a positive verdict
    if [[ "$EVIDENCE_UPPER" == *"REJECTED"* || "$EVIDENCE_UPPER" == *"GUILTY"* ]]; then
        echo ""
        echo "================================================================"
        echo "  SHERLOCK GATE BLOCKED — NEGATIVE VERDICT"
        echo "================================================================"
        echo ""
        echo "  Evidence contains a rejection/failure verdict."
        echo "  Fix the findings and re-run Sherlock before passing this gate."
        echo ""
        echo "================================================================"
        exit 1
    fi

    if [[ "$EVIDENCE_UPPER" != *"APPROVED"* && "$EVIDENCE_UPPER" != *"PASS"* && "$EVIDENCE_UPPER" != *"INNOCENT"* ]]; then
        echo ""
        echo "================================================================"
        echo "  SHERLOCK GATE BLOCKED — NO VERDICT FOUND"
        echo "================================================================"
        echo ""
        echo "  Evidence must contain Sherlock's verdict: APPROVED, PASS, or INNOCENT."
        echo "  Run the Sherlock adversarial review and include the verdict."
        echo ""
        echo "================================================================"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Gate 5: Live smoke test fraud detection
# ---------------------------------------------------------------------------
if [[ "$GATE_NAME" == "05-live-smoke-test" ]]; then
    EVIDENCE_LOWER=$(echo "$EVIDENCE" | tr '[:upper:]' '[:lower:]')

    # Blocked phrases — indicate feature wasn't tested in running binary
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
        "n/a"
        "not applicable"
        "skip"
    )

    for pattern in "${FRAUD_PATTERNS[@]}"; do
        if [[ "$EVIDENCE_LOWER" == *"$pattern"* ]]; then
            echo ""
            echo "================================================================"
            echo "  GATE 5 BLOCKED — FRAUD PATTERN DETECTED"
            echo "================================================================"
            echo ""
            echo "  Evidence contains: \"${pattern}\""
            echo ""
            echo "  Gate 5 (live-smoke-test) requires PROOF that the feature"
            echo "  works in a running binary. Not that tests pass. Not that"
            echo "  it compiles. Not that wiring happens later."
            echo ""
            echo "  Valid evidence must include ONE of:"
            echo "    1. The command you ran and its actual output"
            echo "    2. WIRING_VERIFIED: <grep proof that binary calls the code>"
            echo "    3. Path to a screenshot or log showing the feature working"
            echo ""
            echo "================================================================"
            exit 1
        fi
    done

    # Require positive evidence — must contain at least one proof indicator
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
        "archon"
    )

    PROOF_FOUND=false
    for indicator in "${PROOF_INDICATORS[@]}"; do
        if [[ "$EVIDENCE_LOWER" == *"$indicator"* ]]; then
            PROOF_FOUND=true
            break
        fi
    done

    if [[ "$PROOF_FOUND" != "true" ]]; then
        echo ""
        echo "================================================================"
        echo "  GATE 5 BLOCKED — NO EXECUTION PROOF"
        echo "================================================================"
        echo ""
        echo "  Evidence doesn't contain recognizable execution proof."
        echo "  Must include: a command, output, screenshot, or WIRING_VERIFIED."
        echo ""
        echo "================================================================"
        exit 1
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
