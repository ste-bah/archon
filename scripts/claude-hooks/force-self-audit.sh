#!/usr/bin/env bash
# PreToolUse hook: forces adversarial self-audit when completion summaries appear.
#
# When Claude writes a summary/report file that claims completion (MEMORY.md
# fuckup entries, completion reports, phase summaries, commit messages with
# "complete"), this hook requires the content to include a "Gaps:" or
# "What's NOT working:" section with at least 2 items.
#
# The idea: force Claude to list what's broken/missing BEFORE declaring done.
# If you can't list 2 gaps, you haven't looked hard enough.
#
# This is project-agnostic.

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

if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

FILE_PATH=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    ti = data.get('tool_input', {})
    print(ti.get('file_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

# Apply to summary/completion/report files
IS_SUMMARY=false
case "$(basename "$FILE_PATH" 2>/dev/null)" in
    COMPLETE.md|COMPLETION*.md|SUMMARY*.md|REPORT*.md|PHASE*.md) IS_SUMMARY=true ;;
    *-complete.md|*-summary.md|*-report.md|*-done.md) IS_SUMMARY=true ;;
esac

if [[ "$IS_SUMMARY" != "true" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

CONTENT=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    ti = data.get('tool_input', {})
    print(ti.get('content', '') or ti.get('new_string', ''))
except:
    print('')
" 2>/dev/null || echo "")

LOWER=$(echo "$CONTENT" | tr '[:upper:]' '[:lower:]')

# Look for gaps/limitations/missing sections
HAS_GAPS=false
if echo "$LOWER" | grep -qE "(gaps|limitations|not working|missing|known issues|not yet|incomplete|todo)"; then
    # Count items under these sections (lines starting with - or *)
    GAP_ITEMS=$(echo "$CONTENT" | grep -cE "^[[:space:]]*[-*][[:space:]]" || echo "0")
    if [[ $GAP_ITEMS -ge 2 ]]; then
        HAS_GAPS=true
    fi
fi

if [[ "$HAS_GAPS" == "true" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

cat <<'EOF'
{
  "decision": "block",
  "reason": "BLOCKED: Completion summary / report must include a 'Gaps:' or 'What's NOT working:' or 'Known Limitations:' section with at least 2 bullet items. If you can't list 2 gaps, you haven't audited hard enough. Every completion claim in history has had gaps — list them upfront."
}
EOF
exit 0
