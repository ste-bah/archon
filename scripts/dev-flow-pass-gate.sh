#!/usr/bin/env bash
# Pass a specific dev flow gate for a task.
#
# Usage:
#   ./scripts/dev-flow-pass-gate.sh TASK-XXX gate-name "evidence" [/path/to/work/dir]
#   ./scripts/dev-flow-pass-gate.sh TASK-XXX 05-live-smoke-test --exec "command" [/path/to/work/dir]
#
# Gate 5 has TWO modes:
#   --exec "command"   — The script RUNS the command. Only passes if exit 0.
#                        Claude cannot self-attest. The command's stdout is stored
#                        as evidence. This is the default and preferred mode.
#   --user-verified    — For manual/interactive tests only. Requires $USER to be
#                        a real human (not an AI agent). Stores who verified.
#
# Gate names (must be passed in order):
#   01-tests-written-first      — Test files exist before implementation
#   02-implementation-complete   — Code written and compiles
#   03-sherlock-code-review      — Sherlock adversarial review (must contain APPROVED/PASS)
#   04-tests-passing             — All tests pass (include test count)
#   05-live-smoke-test           — Feature actually invoked end-to-end (MUST USE --exec)
#   06-sherlock-final-review     — Sherlock final review (must contain APPROVED/PASS)

set -euo pipefail

TASK_ID="${1:?Usage: dev-flow-pass-gate.sh TASK-XXX gate-name 'evidence' [/path/to/work/dir]}"
GATE_NAME="${2:?Provide gate name (e.g., 03-sherlock-code-review)}"
EVIDENCE="${3:?Provide evidence string or --exec}"

# Work dir: explicit arg, or git root, or cwd
if [ -n "${4:-}" ]; then
    WORK_DIR="$4"
elif ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    WORK_DIR="$ROOT"
else
    WORK_DIR="$(pwd)"
fi

# Handle --exec mode for gate 5: shift args if 4th arg looks like a workdir
EXEC_CMD=""
USER_VERIFIED=false
if [[ "$EVIDENCE" == "--exec" ]]; then
    EXEC_CMD="${4:?--exec requires a command string}"
    if [ -n "${5:-}" ]; then
        WORK_DIR="$5"
    fi
elif [[ "$EVIDENCE" == "--user-verified" ]]; then
    USER_VERIFIED=true
    EVIDENCE="${4:-manual verification}"
    if [ -n "${5:-}" ]; then
        WORK_DIR="$5"
    fi
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
# Gate 5: Live smoke test — MUST execute real commands, no self-attestation
# ---------------------------------------------------------------------------
if [[ "$GATE_NAME" == "05-live-smoke-test" ]]; then

    # Mode 1: --exec "command" — the script runs it
    if [[ -n "$EXEC_CMD" ]]; then
        echo "Executing smoke test command..."
        echo "  \$ ${EXEC_CMD}"
        echo ""

        # Run the command, capture output and exit code
        set +e
        EXEC_OUTPUT=$(eval "$EXEC_CMD" 2>&1)
        EXEC_EXIT=$?
        set -e

        if [[ $EXEC_EXIT -ne 0 ]]; then
            echo ""
            echo "================================================================"
            echo "  GATE 5 BLOCKED — SMOKE TEST COMMAND FAILED (exit $EXEC_EXIT)"
            echo "================================================================"
            echo ""
            echo "  Command: ${EXEC_CMD}"
            echo "  Exit code: ${EXEC_EXIT}"
            echo ""
            echo "  Output:"
            echo "$EXEC_OUTPUT" | tail -20
            echo ""
            echo "================================================================"
            exit 1
        fi

        # Command succeeded — store the real output as evidence
        EVIDENCE="EXEC_VERIFIED (exit 0): ${EXEC_CMD}
---OUTPUT---
$(echo "$EXEC_OUTPUT" | tail -30)"

    # Mode 2: --user-verified — human attestation only
    elif [[ "$USER_VERIFIED" == "true" ]]; then
        EVIDENCE="USER_VERIFIED by $(whoami) at $(date -Iseconds): ${EVIDENCE}"

    # Mode 3: Self-attested string — BLOCKED
    else
        echo ""
        echo "================================================================"
        echo "  GATE 5 BLOCKED — SELF-ATTESTATION NOT ALLOWED"
        echo "================================================================"
        echo ""
        echo "  Gate 5 (live-smoke-test) no longer accepts self-attested evidence."
        echo ""
        echo "  Use one of:"
        echo "    --exec \"command\"       Run a command; passes only if exit 0"
        echo "    --user-verified \"msg\"  Human-verified (requires real user)"
        echo ""
        echo "  Examples:"
        echo "    ./dev-flow-pass-gate.sh TASK-001 05-live-smoke-test --exec \"your-test-command\""
        echo "    ./dev-flow-pass-gate.sh TASK-001 05-live-smoke-test --user-verified \"tested manually\""
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

# ---------------------------------------------------------------------------
# Behavioral rules injection — query MemoryGraph (FalkorDB) for corrections
# ---------------------------------------------------------------------------
# Queries the MemoryGraph FalkorDB backend directly via Python for behavioral
# rules tagged as corrections/feedback. Project-agnostic — works anywhere
# MemoryGraph is installed.
# Find memorygraph Python — check venv first, then system
MGRAPH_PYTHON=""
if [[ -x "${HOME}/.memorygraph-venv/bin/python3" ]]; then
    MGRAPH_PYTHON="${HOME}/.memorygraph-venv/bin/python3"
elif command -v python3 &>/dev/null; then
    MGRAPH_PYTHON="python3"
fi

MEMORY_OUTPUT=""
if [[ -n "$MGRAPH_PYTHON" ]]; then
    MEMORY_OUTPUT=$(MEMORY_BACKEND="${MEMORY_BACKEND:-falkordblite}" "$MGRAPH_PYTHON" -c "
import sys
try:
    from memorygraph.backends.factory import BackendFactory
    from memorygraph.database import MemoryDatabase
    import asyncio

    async def recall():
        from memorygraph.models import SearchQuery
        backend = await BackendFactory.create_backend()
        db = MemoryDatabase(backend)
        sq = SearchQuery(tags=['correction', 'feedback', 'critical', 'dev-flow'], limit=10, match_mode='any')
        results = await db.search_memories(sq)
        for m in results:
            title = getattr(m, 'title', '') or str(getattr(m, 'content', ''))[:100]
            print(f'  - {title}')

    asyncio.run(recall())
except Exception:
    pass
" 2>/dev/null || true)
fi

if [[ -n "$MEMORY_OUTPUT" ]]; then
    echo ""
    echo "================================================================"
    echo "  BEHAVIORAL RULES (from MemoryGraph)"
    echo "================================================================"
    echo "$MEMORY_OUTPUT"
    echo "================================================================"
else
    echo ""
    echo "================================================================"
    echo "  REMINDERS"
    echo "================================================================"
    echo "  - Gate 5 requires --exec with a REAL command. No self-attestation."
    echo "  - Do NOT claim completion until ALL 6 gates pass."
    echo "  - Do NOT stop to ask between tasks when told to keep going."
    echo "  - Verify wiring end-to-end, not just unit tests in isolation."
    echo "  - Code that isn't wired into the running system is NOT DONE."
    echo "  - NEVER lie about completion status or inflate test counts."
    echo "================================================================"
fi
