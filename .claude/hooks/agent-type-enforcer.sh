#!/usr/bin/env bash
# AGENT TYPE ENFORCER — PreToolUse hook for Agent tool
#
# UNIVERSAL: Works for any project with task spec files containing:
#   Task ID:  TASK-XXX-NNN
#   Agent:    <agent-name>
#
# When Claude spawns an Agent subagent whose prompt mentions a TASK-*
# pattern, this hook:
#   1. Finds the task spec file anywhere in the repo (grep -rl)
#   2. Extracts the Agent: field
#   3. Compares to the subagent_type being used
#   4. BLOCKS if they don't match
#
# This prevents Claude from substituting "coder" when the spec says
# "security-architect", "system-designer", etc.

set -euo pipefail

INPUT=$(cat)

# Only care about Agent tool
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
if [ "$TOOL_NAME" != "Agent" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Extract subagent_type and prompt from tool input
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty' 2>/dev/null)

# No prompt or no subagent type — allow (not a task-related agent spawn)
if [ -z "$PROMPT" ] || [ -z "$SUBAGENT_TYPE" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Extract TASK-XXX-NNN pattern from the prompt
# Matches: TASK-CLI-232, TASK-API-001, TASK-WEB-015, etc.
TASK_ID=$(echo "$PROMPT" | grep -oP 'TASK-[A-Z]+-\d+' | head -1 || true)

# Also try CLI-NNN bare pattern and prepend TASK-
if [ -z "$TASK_ID" ]; then
    BARE_ID=$(echo "$PROMPT" | grep -oP '(?<=TASK-|task-)([A-Z]+-\d+)' | head -1 || true)
    if [ -n "$BARE_ID" ]; then
        TASK_ID="TASK-${BARE_ID}"
    fi
fi

# No task ID in prompt — not a task-related spawn, allow
if [ -z "$TASK_ID" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Find project root
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -z "$ROOT" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Find the task spec file anywhere in the repo
# Search for files containing "Task ID:" followed by our task ID
# Limit search to .md files, skip node_modules/.git/etc
SPEC_FILE=$(grep -rl "Task ID:.*${TASK_ID}" "$ROOT" \
    --include="*.md" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=target \
    --exclude-dir=dist \
    --exclude-dir=build \
    --exclude-dir=.claude \
    2>/dev/null | head -1 || true)

# No spec file found — can't enforce, allow
if [ -z "$SPEC_FILE" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Extract the Agent: field from the spec file
# Format: "Agent:    <name>" with variable whitespace
SPEC_AGENT=$(grep -oP '(?<=^Agent:)\s+\S+' "$SPEC_FILE" 2>/dev/null | head -1 | xargs || true)

# No Agent field in spec — can't enforce, allow
if [ -z "$SPEC_AGENT" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# Compare: does the subagent_type match the spec?
if [ "$SUBAGENT_TYPE" = "$SPEC_AGENT" ]; then
    echo '{"decision": "allow"}'
    exit 0
fi

# MISMATCH — check if this is an allowed substitution
# Some agent types don't exist as subagent_types (e.g., "local-coder").
# In that case, allow "coder" as fallback but ONLY for agents that
# genuinely don't exist. Keep a known-agents list.
#
# If the spec agent exists as a real subagent_type, block substitution.
# If it doesn't exist, allow fallback with a warning.

# Known agent types that exist as real subagent_types in Claude Code
KNOWN_AGENTS="coder reviewer tester researcher sherlock-holmes planner"

SPEC_AGENT_EXISTS=false
for known in $KNOWN_AGENTS; do
    if [ "$known" = "$SPEC_AGENT" ]; then
        SPEC_AGENT_EXISTS=true
        break
    fi
done

# If the spec agent is a known type and Claude is using something different, BLOCK
if [ "$SPEC_AGENT_EXISTS" = "true" ]; then
    echo '{"decision": "block", "reason": "AGENT TYPE MISMATCH: Task '"${TASK_ID}"' specifies Agent: '"${SPEC_AGENT}"' but you are spawning subagent_type: '"${SUBAGENT_TYPE}"'.\n\nThe task spec is the spec. Use subagent_type=\"'"${SPEC_AGENT}"'\" or explain why you cannot.\n\nSpec file: '"${SPEC_FILE}"'"}'
    exit 0
fi

# Spec agent is not a known built-in type (e.g., "rust-systems-coder", "security-architect")
# These are ROLE descriptions. The prompt MUST mention the role name to prove
# Claude is aware of the required expertise and not just substituting blindly.
PROMPT_LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')
SPEC_AGENT_LOWER=$(echo "$SPEC_AGENT" | tr '[:upper:]' '[:lower:]')

if echo "$PROMPT_LOWER" | grep -q "$SPEC_AGENT_LOWER"; then
    # Prompt mentions the role — Claude is aware, allow
    echo '{"decision": "allow"}'
    exit 0
fi

# Prompt does NOT mention the required role — BLOCK
echo '{"decision": "block", "reason": "AGENT ROLE MISMATCH: Task '"${TASK_ID}"' specifies Agent: '"${SPEC_AGENT}"' but you are spawning '"${SUBAGENT_TYPE}"' WITHOUT mentioning the required role in your prompt.\n\nEither:\n  1. Use subagent_type=\"'"${SPEC_AGENT}"'\" if it exists as a custom agent\n  2. Include \"Acting as '"${SPEC_AGENT}"' role\" in your prompt so the agent knows its expertise requirements\n\nYou cannot silently substitute agents. The spec chose '"${SPEC_AGENT}"' for a reason.\n\nSpec file: '"${SPEC_FILE}"'"}'
exit 0
