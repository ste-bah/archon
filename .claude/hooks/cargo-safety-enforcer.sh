#!/bin/bash
# cargo-safety-enforcer.sh — PreToolUse:Bash hook
# BLOCKS any cargo build/test/check/clippy command that is missing:
#   - CARGO_BUILD_JOBS=1 (or --jobs 1 / -j1)
#   - --test-threads=1 or --test-threads=2 (for cargo test only)
#
# This applies to BOTH the parent agent AND all subagents.
# The hook reads JSON from stdin (Claude Code hook protocol).

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Skip if not a Bash tool call or empty command
[ -z "$CMD" ] && exit 0

# Check if the command contains a cargo invocation
# Match: cargo build, cargo test, cargo check, cargo clippy, cargo run
if ! echo "$CMD" | grep -qE '\bcargo\s+(build|test|check|clippy|run)\b'; then
    exit 0
fi

ERRORS=""

# --- Check 1: CARGO_BUILD_JOBS must be set to 1 ---
# Accept: CARGO_BUILD_JOBS=1 (env prefix), --jobs 1, --jobs=1, -j1, -j 1
if ! echo "$CMD" | grep -qP '(CARGO_BUILD_JOBS=1|--jobs[= ]1|-j\s*1)'; then
    ERRORS="${ERRORS}  - Missing CARGO_BUILD_JOBS=1 (or --jobs 1 / -j1)\n"
fi

# --- Check 2: For cargo test, --test-threads must be present ---
if echo "$CMD" | grep -qP '\bcargo\s+test\b'; then
    if ! echo "$CMD" | grep -qP -- '--test-threads=[12]'; then
        ERRORS="${ERRORS}  - Missing --test-threads=1 or --test-threads=2 (required for cargo test)\n"
    fi
fi

# If any errors, BLOCK the command
if [ -n "$ERRORS" ]; then
    echo "============================================================"
    echo "BLOCKED: Cargo command missing WSL2 safety flags"
    echo "============================================================"
    echo ""
    echo "Command: $CMD"
    echo ""
    echo "Missing:"
    echo -e "$ERRORS"
    echo "REQUIRED format examples:"
    echo "  CARGO_BUILD_JOBS=1 cargo check -p archon-core"
    echo "  CARGO_BUILD_JOBS=1 cargo test -p archon-core -- --test-threads=1"
    echo "  CARGO_BUILD_JOBS=1 cargo build --jobs 1"
    echo ""
    echo "WHY: Running cargo without these limits exhausts WSL2 memory"
    echo "and crashes the entire system. This has happened 3+ times."
    echo "============================================================"
    # Output block decision
    echo '{"decision": "block", "reason": "Cargo command missing CARGO_BUILD_JOBS=1 and/or --test-threads for cargo test. WSL2 safety requirement."}'
    exit 1
fi

# Allow the command
exit 0
