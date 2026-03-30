#!/bin/bash
# PreToolUse hook: Block Bash commands containing heredoc patterns.
# Prevents pipeline agents from writing file content via heredoc,
# which corrupts settings.local.json when auto-allowed.
#
# RULE: ALL heredocs are blocked, including /tmp/ writes.
# Agents must use Write tool instead.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ "$TOOL" = "Bash" ]; then
  # Block ALL heredoc patterns — no exceptions, not even /tmp/
  if echo "$COMMAND" | grep -qE "<<\s*'?[A-Za-z_]*EOF[A-Za-z_]*'?|<<\s*'?END'?|<<\s*'?HEREDOC'?|<<\s*'?SUMMARY'?|<<\s*'?REPORT'?|<<\s*'?AGENT'?"; then
    echo '{"decision": "block", "reason": "BLOCKED: Heredoc file writing detected. Use the Write tool instead of Bash heredoc to create files. Heredoc commands corrupt settings.local.json when auto-allowed."}'
    exit 0
  fi
  # Note: Long commands are NOT blocked here (agents need them for tests/builds).
  # The PermissionRequest hook prevents auto-allowing long commands (>500 chars),
  # so they won't silently pollute settings.local.json.
fi

echo '{"decision": "allow"}'
