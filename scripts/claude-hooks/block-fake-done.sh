#!/usr/bin/env bash
# PreToolUse hook: blocks claims of completion without evidence of verification.
#
# Works with any tool call. Reads the hook input JSON, checks the tool's content
# (message text, file content, evidence strings) for completion claims like
# "done", "complete", "finished", "works", "100%", "all passing" etc.
#
# A claim is ALLOWED if the same content contains one of:
#   - Command execution output markers: "$ ", "exit 0", "EXIT: 0", "running N tests"
#   - Tool invocation evidence: "ran:", "output:", "verified by running"
#   - Explicit grep/check output: lines starting with "->" or ">>" or file paths
#   - A URL to live output / screenshot
#   - "User verified" marker
#
# This is project-agnostic. It blocks the behavioural pattern of declaring
# completion in tool calls without attaching execution evidence.

set -euo pipefail

# Read hook input (tool_name, tool_input as JSON)
INPUT=$(cat)

# Extract tool content: check file contents (Write/Edit), command args (Bash),
# and any text payload. We scan the JSON for suspicious phrases.
CONTENT=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    ti = data.get('tool_input', {})
    parts = []
    for k, v in ti.items():
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, (list, dict)):
            parts.append(json.dumps(v))
    print(' '.join(parts))
except Exception:
    print('')
" 2>/dev/null || echo "")

# Lowercase for matching
LOWER=$(echo "$CONTENT" | tr '[:upper:]' '[:lower:]')

# Triggered phrases — claims of completion
TRIGGERS=(
    "all tasks complete"
    "33/33"
    "tests passing, 0 failures"
    "tests passed, 0 failed"
    "phase 3 complete"
    "phase complete"
    "fully wired"
    "fully implemented"
    "100% complete"
    "everything works"
    "all working"
    "production ready"
    "phase.*done"
)

# Evidence phrases — proof of actual verification
EVIDENCE=(
    "exit 0"
    "exit: 0"
    "exit code: 0"
    "\$ cargo"
    "\$ npm"
    "\$ python"
    "\$ node"
    "\$ bash"
    "\$ ./"
    "running [0-9]+ test"
    "ran:"
    "output:"
    "verified by running"
    "user_verified"
    "exec_verified"
    "wiring_verified:"
    "screenshot:"
)

# Check if any trigger is present
TRIGGERED=false
for t in "${TRIGGERS[@]}"; do
    if echo "$LOWER" | grep -qE "$t"; then
        TRIGGERED=true
        break
    fi
done

if [[ "$TRIGGERED" != "true" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Trigger found — check for evidence
HAS_EVIDENCE=false
for e in "${EVIDENCE[@]}"; do
    if echo "$LOWER" | grep -qE "$e"; then
        HAS_EVIDENCE=true
        break
    fi
done

if [[ "$HAS_EVIDENCE" == "true" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Blocked
cat <<'EOF'
{
  "decision": "block",
  "reason": "BLOCKED: Completion claim without evidence. You wrote 'done/complete/passing/working' but attached no execution proof. Before claiming completion you must include: (a) the actual command you ran, (b) its stdout output, (c) a screenshot path, or (d) USER_VERIFIED marker with the human who verified. Rewrite with real evidence."
}
EOF
exit 0
