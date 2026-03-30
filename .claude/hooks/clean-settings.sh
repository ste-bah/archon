#!/bin/bash
# Stop hook: Clean corrupted permission entries from settings.local.json
# Removes any permission entry > 200 chars (heredoc/report content that leaked in)
# and any loop fragment entries (do, done, while read, etc.)
#
# This is a safety net — the PreToolUse block-heredoc.sh hook should prevent
# most of these, but this cleans up any that slip through.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
SETTINGS="$ROOT/.claude/settings.local.json"

[ -f "$SETTINGS" ] || exit 0

# Use jq to filter out corrupted entries
CLEANED=$(jq '
  if .permissions.allow then
    .permissions.allow |= [
      .[] | select(
        # Keep entries under 200 chars
        (length < 200) and
        # Remove loop fragments
        (test("^Bash\\(do ") | not) and
        (test("^Bash\\(done\\)") | not) and
        (test("^Bash\\(while ") | not) and
        # Remove entries with heredoc markers
        (test("EOF|HEREDOC|AGENT_OUTPUT|SUMMARY_EOF|REPORT") | not) and
        # Remove entries with /tmp/ file paths containing heredoc content
        (test("/tmp/.*<<") | not)
      )
    ]
  else .
  end
' "$SETTINGS" 2>/dev/null) || exit 0

# Only write if jq succeeded and output is valid JSON
if [ -n "$CLEANED" ] && echo "$CLEANED" | jq empty 2>/dev/null; then
  BEFORE=$(jq '.permissions.allow | length' "$SETTINGS" 2>/dev/null || echo "?")
  AFTER=$(echo "$CLEANED" | jq '.permissions.allow | length' 2>/dev/null || echo "?")
  if [ "$BEFORE" != "$AFTER" ]; then
    echo "$CLEANED" > "$SETTINGS"
    echo "[settings-clean] Removed $((BEFORE - AFTER)) corrupted permission entries from settings.local.json"
  fi
fi
