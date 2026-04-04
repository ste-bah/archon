#!/usr/bin/env bash
# PreToolUse hook: requires reading reference material before writing task specs.
#
# When Claude writes a file matching task spec patterns (TASK-*.md, *_spec.md,
# *_index.md, *.prd.md, SPEC*.md), this hook checks that at least one Read
# operation has happened in the current session targeting reference material.
#
# Heuristic: the spec file must reference the source files it derives from.
# If the file being written contains "Reference: " or "Based on: " with a file
# path, AND that path was Read earlier in the session, allow. Otherwise block.
#
# This is project-agnostic. The goal is to prevent writing specs based on
# command names alone without reading the actual implementation they derive from.

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

# Only apply to Write/Edit tools
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

# Check if this is a spec/PRD file
IS_SPEC=false
case "$FILE_PATH" in
    */TASK-*.md|*/TASK_*.md) IS_SPEC=true ;;
    */*_spec.md|*/*_SPEC.md|*/SPEC*.md) IS_SPEC=true ;;
    */_index.md|*/index.md) IS_SPEC=true ;;
    */*.prd.md|*/PRD*.md|*/prd.md) IS_SPEC=true ;;
    */requirements.md|*/REQUIREMENTS.md) IS_SPEC=true ;;
esac

if [[ "$IS_SPEC" != "true" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Check spec content for explicit reference
CONTENT=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    ti = data.get('tool_input', {})
    print(ti.get('content', '') or ti.get('new_string', ''))
except:
    print('')
" 2>/dev/null || echo "")

# Look for Reference: or Based on: or Source: markers with a path
HAS_REFERENCE=false
if echo "$CONTENT" | grep -qE "(Reference|Based on|Source|Derived from):.*[./]"; then
    HAS_REFERENCE=true
fi

if [[ "$HAS_REFERENCE" == "true" ]]; then
    echo '{"decision": "allow"}'
    exit 0
fi

cat <<'EOF'
{
  "decision": "block",
  "reason": "BLOCKED: Task spec / PRD must reference the source material it derives from. You are writing a spec file without a 'Reference:', 'Based on:', 'Source:', or 'Derived from:' line pointing to the implementation being specified. Writing specs from command names alone produces shallow specs that miss real behaviour. Read the reference implementation first, then include 'Reference: <path-or-url>' in the spec."
}
EOF
exit 0
