#!/usr/bin/env bash
# TASK-205 META-DEVFLOW-GATE2-FILESIZE — meta-test for the Gate 2
# file-size auto-check.
#
# Exercises 4 paths through the modified `dev-flow-pass-gate.sh`:
#   1. scripts/check-file-sizes.sh exits 0 → Gate 2 records normally.
#   2. scripts/check-file-sizes.sh exits non-zero → Gate 2 refuses,
#      `.passed` NOT written, offender output surfaced.
#   3. `--skip-file-size` flag → Gate 2 bypasses the check, emits WARN,
#      records with a SKIP-FILESIZE marker in evidence.
#   4. No scripts/check-file-sizes.sh in WORK_DIR → Gate 2 skips the
#      check silently and records.
#
# Each test uses a fresh temp WORK_DIR with a fake project layout so the
# test is hermetic: no real project state is touched. Gate 1 is
# pre-seeded in each WORK_DIR so Gate 2 can run (ordering rule).
#
# Exit: 0 if all assertions pass, 1 otherwise.

set -uo pipefail

GATE_SCRIPT="/home/unixdude/Archon-projects/archon/scripts/dev-flow-pass-gate.sh"

if [[ ! -x "$GATE_SCRIPT" ]]; then
    echo "FATAL: expected $GATE_SCRIPT to exist and be executable"
    exit 1
fi

TESTS_PASSED=0
TESTS_FAILED=0

report() {
    local status="$1"
    local name="$2"
    local detail="${3:-}"
    if [[ "$status" == "PASS" ]]; then
        echo "  [PASS] $name${detail:+ — $detail}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "  [FAIL] $name${detail:+ — $detail}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Set up an isolated WORK_DIR with a given check-file-sizes.sh exit code
# (or no script at all, via empty exit-code arg). Pre-seeds Gate 1.
setup_workdir() {
    local root="$1"
    local check_exit="${2:-}"        # "" = no script, otherwise 0/1
    local check_output="${3:-OK}"
    mkdir -p "$root/.gates/META-TEST"
    cat > "$root/.gates/META-TEST/01-tests-written-first.passed" <<'EOF'
PASSED
Gate: 01-tests-written-first
Evidence: meta-test preseeded
EOF
    if [[ -n "$check_exit" ]]; then
        mkdir -p "$root/scripts"
        cat > "$root/scripts/check-file-sizes.sh" <<EOF
#!/usr/bin/env bash
echo '$check_output'
exit $check_exit
EOF
        chmod +x "$root/scripts/check-file-sizes.sh"
    fi
}

TMP=$(mktemp -d)
trap "rm -rf '$TMP'" EXIT

echo "================================================================"
echo " TASK-205 Gate 2 file-size auto-check meta-test"
echo "================================================================"
echo ""

# ---------------------------------------------------------------------------
# Test 1: FileSizeGuard exits 0 → Gate 2 passes.
# ---------------------------------------------------------------------------
echo "--- Test 1: FileSizeGuard green → Gate 2 records"
WD1="$TMP/pass"
setup_workdir "$WD1" 0 "FileSizeGuard: 10 files checked, 0 over 500"

set +e
OUT1=$(bash "$GATE_SCRIPT" META-TEST 02-implementation-complete "cargo check green" "$WD1" 2>&1)
EXIT1=$?
set -e

if [[ $EXIT1 -eq 0 ]]; then
    report PASS "gate script exited 0"
else
    report FAIL "gate script exit $EXIT1" "$(echo "$OUT1" | head -5)"
fi

if [[ -f "$WD1/.gates/META-TEST/02-implementation-complete.passed" ]]; then
    report PASS ".passed file created"
else
    report FAIL ".passed file NOT created"
fi

rm -rf "$WD1"

# ---------------------------------------------------------------------------
# Test 2: FileSizeGuard exits 1 → Gate 2 refuses.
# ---------------------------------------------------------------------------
echo ""
echo "--- Test 2: FileSizeGuard red → Gate 2 blocked"
WD2="$TMP/fail"
setup_workdir "$WD2" 1 "FileSizeGuard: offenders (> 500 lines): 600 src/too_big.rs"

set +e
OUT2=$(bash "$GATE_SCRIPT" META-TEST 02-implementation-complete "cargo check green" "$WD2" 2>&1)
EXIT2=$?
set -e

if [[ $EXIT2 -ne 0 ]]; then
    report PASS "gate script exited non-zero (exit $EXIT2)"
else
    report FAIL "gate script incorrectly exited 0 despite FileSizeGuard failure"
fi

if [[ ! -f "$WD2/.gates/META-TEST/02-implementation-complete.passed" ]]; then
    report PASS ".passed NOT created (gate correctly refused)"
else
    report FAIL ".passed was created despite block"
fi

if echo "$OUT2" | grep -q "too_big.rs\|FileSizeGuard"; then
    report PASS "offender output surfaced"
else
    report FAIL "offender output NOT surfaced" "$(echo "$OUT2" | head -5)"
fi

# ---------------------------------------------------------------------------
# Test 3: --skip-file-size bypass.
# ---------------------------------------------------------------------------
echo ""
echo "--- Test 3: --skip-file-size bypasses check"
WD3="$TMP/skip"
setup_workdir "$WD3" 1 "FileSizeGuard: offenders (> 500 lines): 600 src/too_big.rs"

set +e
OUT3=$(bash "$GATE_SCRIPT" META-TEST 02-implementation-complete --skip-file-size "WIP bypass" "$WD3" 2>&1)
EXIT3=$?
set -e

if [[ $EXIT3 -eq 0 ]]; then
    report PASS "gate script exited 0 with --skip-file-size"
else
    report FAIL "gate script exit $EXIT3 with --skip-file-size" "$(echo "$OUT3" | head -5)"
fi

if [[ -f "$WD3/.gates/META-TEST/02-implementation-complete.passed" ]]; then
    report PASS ".passed file created"
else
    report FAIL ".passed file NOT created"
fi

if grep -q "SKIP-FILESIZE" "$WD3/.gates/META-TEST/02-implementation-complete.passed" 2>/dev/null; then
    report PASS "evidence contains SKIP-FILESIZE marker"
else
    report FAIL "evidence missing SKIP-FILESIZE marker"
fi

if echo "$OUT3" | grep -qi "warn\|skip"; then
    report PASS "WARN/skip message emitted on bypass"
else
    report FAIL "no WARN/skip message on bypass" "$(echo "$OUT3" | head -5)"
fi

# ---------------------------------------------------------------------------
# Test 4: no scripts/check-file-sizes.sh in WORK_DIR → silent skip.
# ---------------------------------------------------------------------------
echo ""
echo "--- Test 4: no check-file-sizes.sh → silent skip"
WD4="$TMP/none"
setup_workdir "$WD4"   # no script arg — nothing created

set +e
OUT4=$(bash "$GATE_SCRIPT" META-TEST 02-implementation-complete "cargo check green" "$WD4" 2>&1)
EXIT4=$?
set -e

if [[ $EXIT4 -eq 0 ]]; then
    report PASS "gate script exited 0 with no check-file-sizes.sh"
else
    report FAIL "gate script exit $EXIT4" "$(echo "$OUT4" | head -5)"
fi

if [[ -f "$WD4/.gates/META-TEST/02-implementation-complete.passed" ]]; then
    report PASS ".passed file created"
else
    report FAIL ".passed file NOT created"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "================================================================"
echo " Meta-test summary: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "================================================================"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
