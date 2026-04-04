#!/usr/bin/env bash
# PreToolUse hook: prevents batching many Agent/Task subagent spawns at once.
#
# The agent harness makes multiple tool calls per turn. If Claude fires more
# than N Agent tool calls in a short window, it's trying to batch tasks —
# which is the exact pattern that leads to shallow unverified completion.
#
# We enforce: at most 3 Agent tool calls within a 120-second window.
#
# This is project-agnostic. State is kept in a per-session file keyed on $PPID.

set -euo pipefail

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

# Only apply to Agent tool (subagent spawns)
if [[ "$TOOL_NAME" != "Agent" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

STATE_DIR="${HOME}/.claude/hooks/.batch-state"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/agent-calls-$$.log"

NOW=$(date +%s)
WINDOW=120
LIMIT=3

# Append current timestamp
echo "$NOW" >> "$STATE_FILE"

# Count timestamps within window
CUTOFF=$((NOW - WINDOW))
RECENT=$(awk -v cutoff="$CUTOFF" '$1 >= cutoff' "$STATE_FILE" | wc -l)

# Prune old entries
awk -v cutoff="$CUTOFF" '$1 >= cutoff' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

if [[ $RECENT -gt $LIMIT ]]; then
    cat <<EOF
{
  "decision": "block",
  "reason": "BLOCKED: Too many Agent subagent spawns ($RECENT in 120s, limit $LIMIT). You're batching tasks — this is the pattern that produces shallow unverified completion. Wait for the current agents to finish, verify their output ran correctly, THEN spawn more. Batching hides failures."
}
EOF
    exit 0
fi

echo '{"decision": "allow"}'
exit 0
