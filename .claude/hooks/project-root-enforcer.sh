#!/bin/bash
# =============================================================================
# PreToolUse[Bash] — Block test/build commands targeting wrong project root
# =============================================================================
# During active /god-code pipeline, checks if test/build commands (vitest, tsc,
# npm test, npm run build) target the correct PROJECT_ROOT. Blocks if they
# would run in the wrong directory.
#
# State file: .claude/runtime/.pipeline-project-root
#   Written by pipeline init (or manually) with the absolute path to the
#   project being worked on (e.g., /Volumes/Externalwork/Translation_Platform)
#
# Input: JSON on stdin from Claude Code PreToolUse event
# Output: JSON {"decision": "allow"} or {"decision": "block", "reason": "..."}
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$ROOT" ] && echo '{"decision": "allow"}' && exit 0

ACTIVE_FILE="$ROOT/.claude/runtime/.god-code-active"
PROJECT_ROOT_FILE="$ROOT/.claude/runtime/.pipeline-project-root"

# Only enforce during active god-code pipeline
if [ ! -f "$ACTIVE_FILE" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Only enforce if a project root is specified
if [ ! -f "$PROJECT_ROOT_FILE" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

EXPECTED_ROOT=$(cat "$PROJECT_ROOT_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$EXPECTED_ROOT" ] && echo '{"decision": "allow"}' && exit 0

# Read the command from stdin
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && echo '{"decision": "allow"}' && exit 0

# Check if this is a test/build command
IS_TEST_BUILD=false
case "$COMMAND" in
  *vitest*|*"npm test"*|*"npm run test"*|*"npx tsc"*|*"npm run build"*|*"npm run typecheck"*|*"npx jest"*|*"npm run lint"*)
    IS_TEST_BUILD=true
    ;;
esac

if [ "$IS_TEST_BUILD" = false ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check if the command targets the expected project root
# It's OK if the command contains the expected root path (cd to it, or absolute path)
if echo "$COMMAND" | grep -q "$EXPECTED_ROOT"; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check if it starts with "cd $EXPECTED_ROOT"
if echo "$COMMAND" | grep -qE "^cd\s+['\"]?${EXPECTED_ROOT}"; then
  echo '{"decision": "allow"}'
  exit 0
fi

# The command is a test/build but doesn't reference the expected project root
cat <<BLOCK
{
  "decision": "block",
  "reason": "WRONG PROJECT ROOT: This test/build command does not target the pipeline's project root. Expected commands to reference: ${EXPECTED_ROOT}. Either cd to that directory first or use an absolute path. The current working directory is the claudeflow-testing project, NOT the project being built."
}
BLOCK
exit 0
