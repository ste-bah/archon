#!/bin/bash
# =============================================================================
# Unit tests for rc-prefilter.sh
# Mocks curl to test different RocketChat response scenarios.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
TOTAL=0

assert_eq() {
    TOTAL=$((TOTAL + 1))
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc"
    else
        FAIL=$((FAIL + 1))
        echo "  FAIL: $desc (expected: '$expected', got: '$actual')"
    fi
}

assert_contains() {
    TOTAL=$((TOTAL + 1))
    local desc="$1" needle="$2" haystack="$3"
    if echo "$haystack" | grep -q "$needle"; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc"
    else
        FAIL=$((FAIL + 1))
        echo "  FAIL: $desc (expected to contain: '$needle')"
    fi
}

# --- Setup mock environment ---
export HOME="/tmp/archon-test-home-$$"
mkdir -p "$HOME" "$HOME/.archon/logs"
export RC_URL_ALLOWLIST="http://localhost:9999"

# Create mock env file
cat > "$HOME/.archon-env" << 'ENVEOF'
RC_URL="http://localhost:9999"
RC_USER_ID="test-user-id-123"
RC_TOKEN="test-token-abc"
ENVEOF
chmod 600 "$HOME/.archon-env"

export LOG_FILE="/tmp/archon-prefilter-test-$$.log"

# --- Test 1: No unread messages ---
echo "Test 1: No unread messages"
curl() {
    echo '{"update":[{"name":"A.I.-Chat","unread":0,"t":"c"},{"name":"general","unread":0,"t":"c"}],"remove":[]}'
}
export -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 when no unread" "0" "$EXIT"
assert_eq "no output when no unread" "" "$OUTPUT"

# --- Test 2: Unread in A.I.-Chat ---
echo "Test 2: Unread in A.I.-Chat"
curl() {
    echo '{"update":[{"name":"A.I.-Chat","unread":3,"t":"c"},{"name":"general","unread":0,"t":"c"}],"remove":[]}'
}
export -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
# Runner doesn't exist, so it should fall back to standalone mode
assert_eq "exits 0 in standalone mode" "0" "$EXIT"
assert_contains "reports unread count" "UNREAD_MESSAGES=3" "$OUTPUT"

# --- Test 3: Unread in non-monitored channel only ---
echo "Test 3: Unread in non-monitored channel (should ignore)"
curl() {
    echo '{"update":[{"name":"A.I.-Chat","unread":0,"t":"c"},{"name":"random","unread":5,"t":"c"}],"remove":[]}'
}
export -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 when unread only in non-monitored" "0" "$EXIT"
assert_eq "no output for non-monitored" "" "$OUTPUT"

# --- Test 4: Unread in DM ---
echo "Test 4: Unread in DM (type 'd')"
curl() {
    echo '{"update":[{"name":"A.I.-Chat","unread":0,"t":"c"},{"name":"steven","unread":2,"t":"d"}],"remove":[]}'
}
export -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 in standalone mode" "0" "$EXIT"
assert_contains "reports DM unread" "UNREAD_MESSAGES=2" "$OUTPUT"

# --- Test 5: RocketChat down (curl fails) ---
echo "Test 5: RocketChat unreachable"
curl() {
    return 7  # Connection refused
}
export -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 on RC failure (graceful)" "0" "$EXIT"

# --- Test 6: Invalid JSON response ---
echo "Test 6: Invalid JSON from RocketChat"
curl() {
    echo 'not json at all'
}
export -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 on bad JSON (graceful)" "0" "$EXIT"

# --- Test 7: Missing env file ---
echo "Test 7: Missing credentials file"
rm "$HOME/.archon-env"
unset -f curl

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 on missing env (graceful)" "0" "$EXIT"

# --- Test 8: Insecure permissions ---
echo "Test 8: Insecure permissions on env file"
cat > "$HOME/.archon-env" << 'ENVEOF'
RC_URL="http://localhost:9999"
RC_USER_ID="test-user-id-123"
RC_TOKEN="test-token-abc"
ENVEOF
chmod 644 "$HOME/.archon-env"

OUTPUT=$(bash "$SCRIPT_DIR/rc-prefilter.sh" 2>&1)
EXIT=$?
assert_eq "exits 0 on insecure perms (graceful)" "0" "$EXIT"

# --- Cleanup ---
rm -rf "$HOME"
rm -f "$LOG_FILE"

# --- Summary ---
echo ""
echo "=== Results: ${PASS}/${TOTAL} passed, ${FAIL} failed ==="
if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0
